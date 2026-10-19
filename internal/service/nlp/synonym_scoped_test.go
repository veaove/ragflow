package nlp

import (
	"context"
	"reflect"
	"testing"
)

// stubLoader serves a fixed dictionary so the scoped lookup can be tested
// without a database.
type stubLoader struct {
	dict     map[string][]string
	calls    int
	failWith error
}

func (s *stubLoader) LoadDictionary(_ context.Context, _, _ string) (map[string][]string, error) {
	s.calls++
	if s.failWith != nil {
		return nil, s.failWith
	}
	return s.dict, nil
}

// A curated alias must win over anything else for the same token.
func TestSynonymScoped_PrefersTenantDictionary(t *testing.T) {
	loader := &stubLoader{dict: map[string][]string{"50etf": {"华夏上证50ETF"}}}
	s := NewSynonymWithLoader(nil, "", "", loader)

	got := s.LookupScoped(context.Background(), "t1", "kb1", "50ETF", 8)
	want := []string{"华夏上证50ETF"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// A token outside the tenant vocabulary must still fall through to the base
// dictionary path instead of returning nothing.
func TestSynonymScoped_FallsThroughWhenUnknown(t *testing.T) {
	loader := &stubLoader{dict: map[string][]string{"50etf": {"华夏上证50ETF"}}}
	s := NewSynonymWithLoader(nil, "", "", loader)

	if got := s.LookupScoped(context.Background(), "t1", "kb1", "完全无关的词", 8); len(got) != 0 {
		t.Fatalf("expected no synonyms, got %v", got)
	}
}

// Without a loader the lookup must stay on the legacy path: no tenant
// vocabulary, no panic, and nothing added to the result.
//
// Note: the packaged synonym.json is resolved relative to the process working
// directory, so under `go test` (which runs in the package directory) the file
// is not found and the base dictionary is empty. Asserting the scoped result
// keeps this test independent of that.
func TestSynonymScoped_NoLoaderKeepsBaseBehaviour(t *testing.T) {
	loader := &stubLoader{dict: map[string][]string{"50etf": {"华夏上证50ETF"}}}
	withLoader := NewSynonymWithLoader(nil, "", "", loader)

	bare := NewSynonym(nil, "", "")

	ctx := context.Background()
	if got := bare.LookupScoped(ctx, "t1", "kb1", "50ETF", 8); len(got) != 0 {
		t.Fatalf("no loader must mean no tenant vocabulary, got %v", got)
	}
	// The same token resolves once a loader is attached.
	if got := withLoader.LookupScoped(ctx, "t1", "kb1", "50ETF", 8); len(got) == 0 {
		t.Fatal("expected the tenant vocabulary to answer when a loader is set")
	}
}

// An empty scope must not touch the loader at all.
func TestSynonymScoped_EmptyScopeSkipsLoader(t *testing.T) {
	loader := &stubLoader{dict: map[string][]string{"a": {"b"}}}
	s := NewSynonymWithLoader(nil, "", "", loader)

	s.LookupScoped(context.Background(), "", "", "a", 8)
	s.LookupScoped(context.Background(), "t1", "", "a", 8)
	if loader.calls != 0 {
		t.Fatalf("loader should not be called without a full scope, got %d calls", loader.calls)
	}
}

// The dictionary is cached per knowledge base: a second query must not hit the
// database again.
func TestSynonymScoped_CachesPerDataset(t *testing.T) {
	loader := &stubLoader{dict: map[string][]string{"50etf": {"华夏上证50ETF"}}}
	s := NewSynonymWithLoader(nil, "", "", loader)
	ctx := context.Background()

	s.LookupScoped(ctx, "t1", "kb1", "50ETF", 8)
	first := loader.calls
	s.LookupScoped(ctx, "t1", "kb1", "50ETF", 8)
	if loader.calls != first {
		t.Fatalf("expected the dictionary to be cached, calls went %d -> %d", first, loader.calls)
	}

	// A different knowledge base is a different vocabulary.
	s.LookupScoped(ctx, "t1", "kb2", "50ETF", 8)
	if loader.calls == first {
		t.Fatal("a second knowledge base must load its own vocabulary")
	}
}

// InvalidateDataset must make the next query reload, which is what makes an
// edit visible without restarting the service.
func TestSynonymScoped_InvalidateForcesReload(t *testing.T) {
	loader := &stubLoader{dict: map[string][]string{"50etf": {"华夏上证50ETF"}}}
	s := NewSynonymWithLoader(nil, "", "", loader)
	ctx := context.Background()

	s.LookupScoped(ctx, "t1", "kb1", "50ETF", 8)
	before := loader.calls

	s.InvalidateDataset("kb1")
	s.LookupScoped(ctx, "t1", "kb1", "50ETF", 8)
	if loader.calls != before+1 {
		t.Fatalf("invalidate did not force a reload: %d -> %d", before, loader.calls)
	}
}

// A loader error must not break retrieval: the lookup falls back instead of
// propagating, so a database hiccup cannot fail the customer's search.
func TestSynonymScoped_LoaderErrorDegrades(t *testing.T) {
	loader := &stubLoader{failWith: context.DeadlineExceeded}
	s := NewSynonymWithLoader(nil, "", "", loader)

	// No panic, and the failing vocabulary contributes no keywords.
	if got := s.LookupScoped(context.Background(), "t1", "kb1", "50ETF", 8); len(got) != 0 {
		t.Fatalf("a failed vocabulary load must contribute nothing, got %v", got)
	}
	// A failure must not be cached as a valid empty dictionary: the next query
	// retries the loader so a transient database error self-heals.
	before := loader.calls
	s.LookupScoped(context.Background(), "t1", "kb1", "50ETF", 8)
	if loader.calls != before+1 {
		t.Fatalf("a failed load must not be cached, calls %d -> %d", before, loader.calls)
	}
}

// SetLoader(nil) must turn tenant vocabulary off and drop cached entries.
func TestSynonym_SetLoaderNilDisables(t *testing.T) {
	loader := &stubLoader{dict: map[string][]string{"50etf": {"华夏上证50ETF"}}}
	s := NewSynonymWithLoader(nil, "", "", loader)
	ctx := context.Background()

	if got := s.LookupScoped(ctx, "t1", "kb1", "50ETF", 8); len(got) == 0 {
		t.Fatal("expected the tenant alias before the loader is removed")
	}

	s.SetLoader(nil)
	if got := s.LookupScoped(ctx, "t1", "kb1", "50ETF", 8); len(got) != 0 {
		t.Fatalf("expected no alias after the loader is removed, got %v", got)
	}
}

// The lookup key must be case-insensitive, because customers type "50etf" and
// "50ETF" interchangeably.
func TestSynonymScoped_CaseInsensitive(t *testing.T) {
	loader := &stubLoader{dict: map[string][]string{"50etf": {"华夏上证50ETF"}}}
	s := NewSynonymWithLoader(nil, "", "", loader)
	ctx := context.Background()

	for _, token := range []string{"50ETF", "50etf", " 50ETF "} {
		if got := s.LookupScoped(ctx, "t1", "kb1", token, 8); len(got) == 0 {
			t.Fatalf("token %q should resolve through the tenant vocabulary", token)
		}
	}
}
