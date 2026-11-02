//
//  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//

package kgview

import (
	"sort"
	"strings"
)

// The detail panel never needs more than a handful of quotes per item; the
// rest only inflates the payload.
const (
	maxEvidencePerItem = 3
	maxSourceDocs      = 3
	maxDescriptionLen  = 240
)

type nodeBuilder struct {
	key          string
	names        map[string]struct{}
	rawTypeCount map[string]int
	typeCount    map[string]int
	descriptions []string
	aliases      map[string]struct{}
	mention      int
	chunks       map[string]struct{}
	docs         map[string]struct{}
}

func newNodeBuilder(key, name string) *nodeBuilder {
	return &nodeBuilder{
		key:          key,
		names:        map[string]struct{}{name: {}},
		rawTypeCount: map[string]int{},
		typeCount:    map[string]int{},
		aliases:      map[string]struct{}{},
		chunks:       map[string]struct{}{},
		docs:         map[string]struct{}{},
	}
}

func (b *nodeBuilder) merge(raw RawEntity, name string) {
	b.names[name] = struct{}{}
	typ := NormalizeEntityType(raw.Type)
	b.typeCount[typ.Type]++
	if trimmed := strings.TrimSpace(raw.Type); trimmed != "" {
		b.rawTypeCount[trimmed]++
	}
	if desc := strings.TrimSpace(raw.Description); desc != "" {
		b.descriptions = append(b.descriptions, desc)
	}
	for _, alias := range raw.Aliases {
		if alias = strings.TrimSpace(alias); alias != "" {
			b.aliases[alias] = struct{}{}
		}
	}
	if raw.MentionCount > b.mention {
		b.mention = raw.MentionCount
	}
	if b.mention == 0 {
		b.mention = 1
	}
	for _, id := range raw.ChunkIDs {
		if id != "" {
			b.chunks[id] = struct{}{}
		}
	}
	for _, id := range raw.DocIDs {
		if id != "" {
			b.docs[id] = struct{}{}
		}
	}
}

func (b *nodeBuilder) canonicalType() string {
	best, bestCount := "other", 0
	for typ, count := range b.typeCount {
		if count > bestCount || (count == bestCount && typ < best) {
			best, bestCount = typ, count
		}
	}
	return best
}

func (b *nodeBuilder) rawType() string {
	best, bestCount := "", 0
	for typ, count := range b.rawTypeCount {
		if count > bestCount || (count == bestCount && typ < best) {
			best, bestCount = typ, count
		}
	}
	return best
}

// displayName prefers the most specific surface form ("华夏基金管理有限公司"
// over "华夏基金") so the graph label is unambiguous; the other forms still show
// up as aliases in the detail panel.
func (b *nodeBuilder) displayName() string {
	best := ""
	for name := range b.names {
		if len([]rune(name)) > len([]rune(best)) || (len([]rune(name)) == len([]rune(best)) && name < best) {
			best = name
		}
	}
	return best
}

func (b *nodeBuilder) description() string {
	best := ""
	for _, desc := range b.descriptions {
		if len(desc) > len(best) {
			best = desc
		}
	}
	return Snippet(best, maxDescriptionLen)
}

type edgeBuilder struct {
	key         string
	fromKey     string
	toKey       string
	typ         string
	label       string
	normalized  bool
	rawTypes    map[string]struct{}
	descriptions []string
	confidence  float64
	chunks      map[string]struct{}
	docs        map[string]struct{}
}

func newEdgeBuilder(fromKey, toKey, typ string) *edgeBuilder {
	return &edgeBuilder{
		key:      fromKey + "\x00" + toKey + "\x00" + typ,
		fromKey:  fromKey,
		toKey:    toKey,
		typ:      typ,
		rawTypes: map[string]struct{}{},
		chunks:   map[string]struct{}{},
		docs:     map[string]struct{}{},
	}
}

func (e *edgeBuilder) merge(raw RawRelation) {
	if trimmed := strings.TrimSpace(raw.Type); trimmed != "" {
		e.rawTypes[trimmed] = struct{}{}
	}
	if desc := strings.TrimSpace(raw.Description); desc != "" {
		e.descriptions = append(e.descriptions, desc)
	}
	if conf, ok := ClampConfidence(raw.Confidence); ok && conf > e.confidence {
		e.confidence = conf
	}
	for _, id := range raw.ChunkIDs {
		if id != "" {
			e.chunks[id] = struct{}{}
		}
	}
	for _, id := range raw.DocIDs {
		if id != "" {
			e.docs[id] = struct{}{}
		}
	}
}

func sortedKeys(set map[string]struct{}) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

// Build merges raw rows into the browseable graph.
//
// Identity rules (the part that decides whether the graph is readable):
//   - entities merge by EntityKey (case/punctuation/legal-suffix folded name),
//     aliases from extraction also resolve to the merged node;
//   - relations merge by (from, to, canonical type) and accumulate support;
//   - an endpoint without its own entity row still gets a node, so a relation is
//     never dropped just because the entity row was cut or missing.
func Build(in Input, opts Options) *Payload {
	maxNodes, maxEdges := NormalizeLimits(opts)

	nodes := make(map[string]*nodeBuilder, len(in.Entities))
	aliasIndex := make(map[string]string, len(in.Entities)*2)

	for _, raw := range in.Entities {
		name := strings.TrimSpace(raw.Name)
		if name == "" {
			continue
		}
		key := EntityKey(name)
		if key == "" {
			continue
		}
		builder, ok := nodes[key]
		if !ok {
			builder = newNodeBuilder(key, name)
			nodes[key] = builder
		}
		builder.merge(raw, name)
		if alias := NormalizeName(name); alias != "" {
			if _, exists := aliasIndex[alias]; !exists {
				aliasIndex[alias] = key
			}
		}
		for _, rawAlias := range raw.Aliases {
			alias := NormalizeName(rawAlias)
			if alias == "" {
				continue
			}
			if _, exists := aliasIndex[alias]; !exists {
				aliasIndex[alias] = key
			}
		}
	}

	resolve := func(name string) (string, bool) {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			return "", false
		}
		if key := EntityKey(trimmed); key != "" {
			if _, ok := nodes[key]; ok {
				return key, true
			}
		}
		if key, ok := aliasIndex[NormalizeName(trimmed)]; ok {
			return key, true
		}
		return "", false
	}

	edges := make(map[string]*edgeBuilder, len(in.Relations))
	for _, raw := range in.Relations {
		fromKey, ok := resolve(raw.From)
		if !ok {
			fromKey = ensureNode(nodes, aliasIndex, raw.From)
		}
		toKey, ok := resolve(raw.To)
		if !ok {
			toKey = ensureNode(nodes, aliasIndex, raw.To)
		}
		if fromKey == "" || toKey == "" || fromKey == toKey {
			continue
		}
		typ, label, known := NormalizeRelationType(raw.Type)
		key := fromKey + "\x00" + toKey + "\x00" + typ
		builder, ok := edges[key]
		if !ok {
			builder = newEdgeBuilder(fromKey, toKey, typ)
			builder.label = label
			builder.normalized = known
			edges[key] = builder
		}
		builder.merge(raw)
	}

	// Degree is computed on the merged graph; it drives node radius in both
	// layouts, so hubs are visible before any truncation.
	degree := make(map[string]int, len(nodes))
	for _, edge := range edges {
		degree[edge.fromKey]++
		degree[edge.toKey]++
	}

	nodeIDs := make(map[string]string, len(nodes))
	apiNodes := make([]Node, 0, len(nodes))
	for key, builder := range nodes {
		spec := EntityTypeSpecByID(builder.canonicalType())
		id := StableID("n", key)
		nodeIDs[key] = id
		apiNodes = append(apiNodes, Node{
			ID:           id,
			Name:         builder.displayName(),
			Type:         spec.Type,
			TypeLabel:    spec.Label,
			Color:        spec.Color,
			Icon:         spec.Icon,
			RawType:      builder.rawType(),
			Description:  builder.description(),
			Aliases:      aliasList(builder),
			MentionCount: builder.mention,
			Degree:       degree[key],
			SourceDocs:   in.sourceDocs(builder.docs),
			Evidence:     in.evidenceFor(builder.chunks, maxEvidencePerItem),
		})
	}

	apiEdges := make([]Edge, 0, len(edges))
	for _, builder := range edges {
		support := Support{Chunks: len(builder.chunks), Docs: len(builder.docsOrDerived(in))}
		confidence := builder.confidence
		if confidence == 0 {
			confidence = Confidence(support.Chunks)
		}
		apiEdges = append(apiEdges, Edge{
			ID:          StableID("e", builder.fromKey, builder.toKey, builder.typ),
			Source:      nodeIDs[builder.fromKey],
			Target:      nodeIDs[builder.toKey],
			Type:        builder.typ,
			TypeLabel:   builder.label,
			RawTypes:    sortedKeys(builder.rawTypes),
			Normalized:  builder.normalized,
			Description: Snippet(bestDescription(builder.descriptions), maxDescriptionLen),
			Confidence:  confidence,
			Support:     support,
			Evidence:    in.evidenceFor(builder.chunks, maxEvidencePerItem),
		})
	}

	sortNodes(apiNodes)
	sortEdges(apiEdges)

	payload := &Payload{
		Stats: Stats{
			Entities:              len(apiNodes),
			Relations:             len(apiEdges),
			WithEvidence:          countWithEvidence(apiEdges),
			UnnormalizedRelations: countUnnormalized(apiEdges),
			Domain:                InferDomain(nodeTypes(apiNodes)),
		},
		EntityTypes:   entityTypeCounts(apiNodes),
		RelationTypes: relationTypeCounts(apiEdges),
	}

	truncatedNodes := len(apiNodes) > maxNodes
	if truncatedNodes {
		apiNodes = apiNodes[:maxNodes]
	}
	kept := make(map[string]struct{}, len(apiNodes))
	for _, node := range apiNodes {
		kept[node.ID] = struct{}{}
	}
	filteredEdges := apiEdges[:0]
	for _, edge := range apiEdges {
		if _, ok := kept[edge.Source]; !ok {
			continue
		}
		if _, ok := kept[edge.Target]; !ok {
			continue
		}
		filteredEdges = append(filteredEdges, edge)
	}
	truncatedEdges := len(filteredEdges) > maxEdges
	if truncatedEdges {
		filteredEdges = filteredEdges[:maxEdges]
	}

	payload.Graph = Graph{Nodes: apiNodes, Edges: filteredEdges}
	payload.Stats.ReturnedEntities = len(apiNodes)
	payload.Stats.ReturnedRelations = len(filteredEdges)
	payload.Stats.Truncated = truncatedNodes || truncatedEdges || payload.Stats.Relations > len(filteredEdges)

	if keywords := strings.TrimSpace(opts.Keywords); keywords != "" {
		payload.Search = Search(payload, keywords, opts.Mode)
	}
	return payload
}

// ensureNode materializes a node for a relation endpoint that has no entity
// row of its own. Losing the edge would be worse than showing a node without
// attributes: the whole point of the graph is the edges.
func ensureNode(nodes map[string]*nodeBuilder, aliasIndex map[string]string, name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}
	key := EntityKey(trimmed)
	if key == "" {
		return ""
	}
	if _, ok := nodes[key]; !ok {
		nodes[key] = newNodeBuilder(key, trimmed)
		nodes[key].mention = 1
	}
	if alias := NormalizeName(trimmed); alias != "" {
		if _, exists := aliasIndex[alias]; !exists {
			aliasIndex[alias] = key
		}
	}
	return key
}

func aliasList(b *nodeBuilder) []string {
	display := b.displayName()
	out := make([]string, 0, len(b.aliases)+len(b.names))
	seen := map[string]struct{}{NormalizeName(display): {}}
	for _, alias := range sortedKeys(b.aliases) {
		key := NormalizeName(alias)
		if key == "" || key == NormalizeName(display) {
			continue
		}
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, alias)
	}
	for _, name := range sortedKeys(b.names) {
		key := NormalizeName(name)
		if key == "" || key == NormalizeName(display) {
			continue
		}
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, name)
	}
	return out
}

func (b *edgeBuilder) docsOrDerived(in Input) map[string]struct{} {
	if len(b.docs) > 0 {
		return b.docs
	}
	derived := map[string]struct{}{}
	for _, chunkID := range sortedKeys(b.chunks) {
		if evidence, ok := in.Evidence[chunkID]; ok && evidence.DocID != "" {
			derived[evidence.DocID] = struct{}{}
		}
	}
	return derived
}

func (in Input) evidenceFor(chunkIDs map[string]struct{}, limit int) []Evidence {
	if len(chunkIDs) == 0 || limit <= 0 {
		return nil
	}
	out := make([]Evidence, 0, limit)
	for _, chunkID := range sortedKeys(chunkIDs) {
		evidence, ok := in.Evidence[chunkID]
		if !ok {
			continue
		}
		if evidence.ChunkID == "" {
			evidence.ChunkID = chunkID
		}
		out = append(out, evidence)
		if len(out) >= limit {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (in Input) sourceDocs(docIDs map[string]struct{}) []SourceDoc {
	if len(docIDs) == 0 {
		return nil
	}
	ids := sortedKeys(docIDs)
	if len(ids) > maxSourceDocs {
		ids = ids[:maxSourceDocs]
	}
	out := make([]SourceDoc, 0, len(ids))
	for _, id := range ids {
		name := in.DocNames[id]
		if name == "" {
			name = id
		}
		out = append(out, SourceDoc{ID: id, Name: name})
	}
	return out
}

func bestDescription(descriptions []string) string {
	best := ""
	for _, desc := range descriptions {
		if len(desc) > len(best) {
			best = desc
		}
	}
	return best
}

func sortNodes(nodes []Node) {
	sort.SliceStable(nodes, func(i, j int) bool {
		if nodes[i].Degree != nodes[j].Degree {
			return nodes[i].Degree > nodes[j].Degree
		}
		if nodes[i].MentionCount != nodes[j].MentionCount {
			return nodes[i].MentionCount > nodes[j].MentionCount
		}
		return nodes[i].Name < nodes[j].Name
	})
}

func sortEdges(edges []Edge) {
	sort.SliceStable(edges, func(i, j int) bool {
		if edges[i].Confidence != edges[j].Confidence {
			return edges[i].Confidence > edges[j].Confidence
		}
		if edges[i].Support.Chunks != edges[j].Support.Chunks {
			return edges[i].Support.Chunks > edges[j].Support.Chunks
		}
		return edges[i].ID < edges[j].ID
	})
}

func countUnnormalized(edges []Edge) int {
	count := 0
	for _, edge := range edges {
		if !edge.Normalized {
			count++
		}
	}
	return count
}

func countWithEvidence(edges []Edge) int {
	count := 0
	for _, edge := range edges {
		if len(edge.Evidence) > 0 {
			count++
		}
	}
	return count
}

func nodeTypes(nodes []Node) []string {
	types := make([]string, 0, len(nodes))
	for _, node := range nodes {
		types = append(types, node.Type)
	}
	return types
}

func entityTypeCounts(nodes []Node) []TypeCount {
	counts := map[string]int{}
	for _, node := range nodes {
		counts[node.Type]++
	}
	out := make([]TypeCount, 0, len(counts))
	for typ, count := range counts {
		spec := EntityTypeSpecByID(typ)
		out = append(out, TypeCount{
			Type:   spec.Type,
			Label:  spec.Label,
			Color:  spec.Color,
			Icon:   spec.Icon,
			Domain: spec.Domain,
			Count:  count,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Type < out[j].Type
	})
	return out
}

func relationTypeCounts(edges []Edge) []TypeCount {
	counts := map[string]int{}
	for _, edge := range edges {
		counts[edge.Type]++
	}
	out := make([]TypeCount, 0, len(counts))
	for typ, count := range counts {
		out = append(out, TypeCount{Type: typ, Label: RelationTypeLabel(typ), Count: count})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Type < out[j].Type
	})
	return out
}

// NormalizeLimits applies defaults and hard caps to the requested page size.
func NormalizeLimits(opts Options) (int, int) {
	maxNodes := opts.MaxNodes
	if maxNodes <= 0 {
		maxNodes = DefaultMaxNodes
	}
	if maxNodes > MaxNodesLimit {
		maxNodes = MaxNodesLimit
	}
	maxEdges := opts.MaxEdges
	if maxEdges <= 0 {
		maxEdges = DefaultMaxEdges
	}
	if maxEdges > MaxEdgesLimit {
		maxEdges = MaxEdgesLimit
	}
	return maxNodes, maxEdges
}
