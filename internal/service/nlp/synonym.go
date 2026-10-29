// Copyright 2025 The InfiniFlow Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package nlp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"ragflow/internal/common"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"go.uber.org/zap"
)

// Synonym provides synonym lookup functionality
// Reference: rag/nlp/synonym.py Dealer class
type Synonym struct {
	lookupNum  atomic.Int64
	loadTm     time.Time
	dictionary map[string][]string
	redis      Client // Optional Redis client for real-time synonym loading
	wordNet    *WordNet
	resPath    string

	// loader reads the tenant-scoped vocabulary that overlays the packaged
	// synonym.json base dictionary. It is nil when no database is wired in,
	// which keeps the file-only behaviour of a single-node deployment.
	// It is an atomic pointer because SetSynonymLoader may run while queries
	// are in flight.
	loader atomic.Pointer[SynonymLoader]
	// dbDict caches the loaded vocabulary per knowledge base. Entries are
	// dropped wholesale by InvalidateDataset so an edit takes effect on the
	// next query without a restart.
	dbDict sync.Map // datasetID -> *dbDictEntry
}

// dbDictEntry is one cached vocabulary dictionary plus the load timestamp used
// for diagnostics. The dict is never mutated after publication, so readers can
// use it without holding a lock.
type dbDictEntry struct {
	dict     map[string][]string
	loadedAt atomic.Int64
}

// SynonymLoader supplies the tenant-scoped vocabulary that is merged on top of
// the packaged synonym.json base dictionary.
type SynonymLoader interface {
	// LoadDictionary returns word -> synonyms for one knowledge base. Returning
	// an empty map means "no custom vocabulary", which is not an error.
	LoadDictionary(ctx context.Context, tenantID, datasetID string) (map[string][]string, error)
}

// Client interface for Redis operations
// This should be implemented by the caller if Redis support is needed
type Client interface {
	Get(key string) (string, error)
}

// NewSynonym creates a new Synonym instance
// Reference: synonym.py Dealer.__init__
// wordnetDir: path to wordnet directory (e.g., "/usr/share/infinity/resource/wordnet").
//
//	If empty, WordNet will not be initialized.
func NewSynonym(redis Client, resPath string, wordnetDir string) *Synonym {
	return NewSynonymWithLoader(redis, resPath, wordnetDir, nil)
}

// NewSynonymWithLoader creates a Synonym instance that can additionally resolve
// tenant-scoped vocabulary from loader. A nil loader preserves the packaged
// dictionary only behaviour.
func NewSynonymWithLoader(redis Client, resPath string, wordnetDir string, loader SynonymLoader) *Synonym {
	s := &Synonym{
		loadTm:     time.Now().Add(-1000000 * time.Second),
		dictionary: make(map[string][]string),
		redis:      redis,
		wordNet:    nil, // Will be initialized below
		resPath:    resPath,
	}
	s.lookupNum.Store(100000000)
	if loader != nil {
		s.SetLoader(loader)
	}

	if resPath == "" {
		s.resPath = "internal/rag/res"
	}

	// Initialize WordNet with provided path
	if wordnetDir != "" {
		wordNet, err := NewWordNet(wordnetDir)
		if err != nil {
			// WordNet is optional, continue without it
			s.wordNet = nil
		} else {
			s.wordNet = wordNet
		}
	}

	// Load synonym.json
	path := filepath.Join(s.resPath, "synonym.json")
	if data, err := os.ReadFile(path); err == nil {
		var dict map[string]interface{}
		if err := json.Unmarshal(data, &dict); err == nil {
			// Convert to lowercase keys and string slices
			for k, v := range dict {
				key := strings.ToLower(k)
				switch val := v.(type) {
				case string:
					s.dictionary[key] = []string{val}
				case []interface{}:
					strSlice := make([]string, 0, len(val))
					for _, item := range val {
						if str, ok := item.(string); ok {
							strSlice = append(strSlice, str)
						}
					}
					s.dictionary[key] = strSlice
				}
			}
		} else {
			common.Warn("Failed to parse synonym.json", zap.Error(err))
		}
	} else {
		common.Warn("Missing synonym.json", zap.Error(err))
	}

	if redis == nil {
		common.Warn("Realtime synonym is disabled, since no redis connection.")
	}

	if len(s.dictionary) == 0 {
		common.Warn("Fail to load synonym")
	}

	s.load()

	return s
}

// load loads synonyms from Redis if available
// Reference: synonym.py Dealer.load
func (s *Synonym) load() {
	//if s.redis == nil {
	//	return
	//}
	//
	//if s.lookupNum < 100 {
	//	return
	//}
	//
	//tm := time.Now()
	//if tm.Sub(s.loadTm).Seconds() < 3600 {
	//	return
	//}
	//
	//s.loadTm = time.Now()
	//s.lookupNum = 0
	//
	//data, err := s.redis.Get("kevin_synonyms")
	//if err != nil || data == "" {
	//	return
	//}
	//
	//var dict map[string][]string
	//if jsonErr := json.Unmarshal([]byte(data), &dict); jsonErr != nil {
	//	logger.Error("Fail to load synonym!", jsonErr)
	//	return
	//}
	//
	//s.dictionary = dict
}

// Lookup looks up synonyms for a given token
// Reference: synonym.py Dealer.lookup
func (s *Synonym) Lookup(tk string, topN int) []string {
	return s.LookupScoped(context.Background(), "", "", tk, topN)
}

// LookupScoped resolves tk against the tenant's vocabulary for datasetID first,
// then against the packaged base dictionary and WordNet.
//
// An empty tenantID or datasetID keeps the legacy file-only behaviour, so
// callers that have no knowledge-base context are unaffected.
func (s *Synonym) LookupScoped(ctx context.Context, tenantID, datasetID, tk string, topN int) []string {
	return s.LookupScopedWithAliases(ctx, tenantID, datasetID, tk, topN, nil)
}

// LookupScopedWithAliases is LookupScoped plus a second chance at the same
// vocabulary through tokenizer-shaped keys.
//
// A vocabulary entry is stored exactly as the customer typed it, but the query
// path asks the dictionary about a *segment*: "基金怎么买" is normalised to
// "基金买" before the lookup happens. An entry written "基金是怎么买" therefore
// never matched, and adding it changed nothing at all — which is exactly what
// the customer reported ("加了相似词，感觉没生效") while the change-set preview,
// which tokenises the entry, showed an effect.
//
// aliasKeys returns the segmented forms of one entry, so both spellings resolve
// to the same group. Pass nil for verbatim-only behaviour.
func (s *Synonym) LookupScopedWithAliases(ctx context.Context, tenantID, datasetID, tk string, topN int, aliasKeys func(string) []string) []string {
	if tk == "" {
		return []string{}
	}

	if topN <= 0 {
		topN = 8
	}

	key := normalizeSynonymKey(tk)

	// 1) Tenant vocabulary wins: it is the only source the customer curates,
	// so it must take precedence over the generic packaged dictionary.
	if dict := s.tenantDictionary(ctx, tenantID, datasetID, aliasKeys); dict != nil {
		if res, ok := dict[key]; ok && len(res) > 0 {
			if len(res) > topN {
				return res[:topN]
			}
			return res
		}
	}

	// 2) Custom dictionary loaded from synonym.json
	s.lookupNum.Add(1)
	//s.load()

	if res, ok := s.dictionary[key]; ok {
		if len(res) > topN {
			return res[:topN]
		}
		return res
	}

	// 3) If not found and tk is purely alphabetical, fallback to WordNet
	if matched, _ := regexp.MatchString(`^[a-z]+$`, tk); matched && s.wordNet != nil {
		wnSet := make(map[string]struct{})
		synsets := s.wordNet.Synsets(tk, "")
		for _, syn := range synsets {
			// Extract word from synset name (format: word.pos.num)
			parts := strings.Split(syn.Name, ".")
			if len(parts) > 0 {
				word := strings.ReplaceAll(parts[0], "_", " ")
				wnSet[word] = struct{}{}
			}
		}
		// Remove the original token itself
		delete(wnSet, tk)

		// Convert to slice
		wnRes := make([]string, 0, len(wnSet))
		for w := range wnSet {
			if w != "" {
				wnRes = append(wnRes, w)
			}
		}

		// Sort for deterministic results (map iteration order is non-deterministic in Go)
		sort.Strings(wnRes)

		if len(wnRes) > topN {
			return wnRes[:topN]
		}
		return wnRes
	}

	// 4) Nothing found in any source
	return []string{}
}

// normalizeSynonymKey folds the lookup key the same way the dictionary was
// built, so "  50ETF " and "50etf" resolve to the same entry.
func normalizeSynonymKey(tk string) string {
	key := strings.TrimSpace(tk)
	key = regexp.MustCompile(`[ \t]+`).ReplaceAllString(key, " ")
	return strings.ToLower(key)
}

// currentLoader returns the configured vocabulary loader, or nil when none is
// wired.
func (s *Synonym) currentLoader() SynonymLoader {
	if p := s.loader.Load(); p != nil {
		return *p
	}
	return nil
}

// SetLoader attaches or replaces the tenant vocabulary loader at runtime.
// Passing nil disables tenant vocabulary, which also clears cached entries so
// no stale vocabulary survives the switch.
func (s *Synonym) SetLoader(loader SynonymLoader) {
	if loader == nil {
		s.loader.Store(nil)
	} else {
		s.loader.Store(&loader)
	}
	s.InvalidateAll()
}

// tenantDictionary returns the cached tenant vocabulary for a knowledge base,
// loading it on first use. It returns nil when no loader is wired or the scope
// is incomplete, which leaves the caller on the base dictionary.
func (s *Synonym) tenantDictionary(ctx context.Context, tenantID, datasetID string, aliasKeys func(string) []string) map[string][]string {
	loader := s.currentLoader()
	if loader == nil || tenantID == "" || datasetID == "" {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	if cached, ok := s.dbDict.Load(datasetID); ok {
		if entry, ok := cached.(*dbDictEntry); ok && entry != nil {
			return entry.dict
		}
	}

	dict, err := loader.LoadDictionary(ctx, tenantID, datasetID)
	if err != nil {
		// A vocabulary read failure must not break retrieval: the query still
		// runs against the base dictionary and WordNet.
		common.Warn("Failed to load tenant synonym dictionary",
			zap.String("tenant_id", tenantID),
			zap.String("dataset_id", datasetID),
			zap.Error(err))
		return nil
	}
	if dict == nil {
		dict = map[string][]string{}
	}
	// Cache what the loader returned, widened with the entries' segmented
	// forms. The cache is keyed by dataset only, so a later verbatim-only
	// caller reuses the widened map — strictly more keys, never fewer.
	dict = withEntryAliases(dict, aliasKeys)

	entry := &dbDictEntry{dict: dict}
	entry.loadedAt.Store(time.Now().UnixMilli())
	actual, _ := s.dbDict.LoadOrStore(datasetID, entry)
	if stored, ok := actual.(*dbDictEntry); ok {
		return stored.dict
	}
	return dict
}

// withEntryAliases widens a vocabulary with the tokenizer-shaped form of every
// entry, keeping the verbatim key.
//
// The two spellings must resolve to the same group: the customer stores
// "基金是怎么买", the query asks about the segment "基金买". Without the alias
// the entry is dead weight and the group never fires for that phrasing.
//
// The loader's map is never mutated — it is shared with the cache.
func withEntryAliases(dict map[string][]string, aliasKeys func(string) []string) map[string][]string {
	if aliasKeys == nil || len(dict) == 0 {
		return dict
	}

	extra := make(map[string][]string, len(dict))
	for entry, members := range dict {
		if len(members) == 0 {
			continue
		}
		for _, alias := range aliasKeys(entry) {
			alias = strings.ToLower(strings.TrimSpace(alias))
			if alias == "" || alias == strings.ToLower(strings.TrimSpace(entry)) {
				continue
			}
			extra[alias] = append(extra[alias], members...)
		}
	}
	if len(extra) == 0 {
		return dict
	}

	merged := make(map[string][]string, len(dict)+len(extra))
	for key, members := range dict {
		merged[key] = dedupeMembers(members)
	}
	for key, members := range extra {
		merged[key] = dedupeMembers(append(merged[key], members...))
	}
	return merged
}

// dedupeMembers drops repeats and empty strings while preserving order, so an
// entry reached through both its verbatim and segmented key does not spend two
// of the caller's synonym slots on the same word.
func dedupeMembers(members []string) []string {
	if len(members) < 2 {
		if len(members) == 1 && members[0] == "" {
			return nil
		}
		return members
	}
	seen := make(map[string]struct{}, len(members))
	out := make([]string, 0, len(members))
	for _, m := range members {
		if m == "" {
			continue
		}
		if _, ok := seen[m]; ok {
			continue
		}
		seen[m] = struct{}{}
		out = append(out, m)
	}
	return out
}

// InvalidateDataset drops the cached vocabulary of one knowledge base so the
// next query reloads it. Call it after any synonym write.
func (s *Synonym) InvalidateDataset(datasetID string) {
	if datasetID == "" {
		return
	}
	s.dbDict.Delete(datasetID)
}

// InvalidateAll drops every cached vocabulary.
func (s *Synonym) InvalidateAll() {
	s.dbDict.Range(func(key, _ any) bool {
		s.dbDict.Delete(key)
		return true
	})
}

// GetDictionary returns the synonym dictionary
func (s *Synonym) GetDictionary() map[string][]string {
	return s.dictionary
}

// GetLookupNum returns the number of lookups since last load
func (s *Synonym) GetLookupNum() int {
	return int(s.lookupNum.Load())
}

// GetLoadTime returns the last load time
func (s *Synonym) GetLoadTime() time.Time {
	return s.loadTm
}
