package nlp

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"ragflow/internal/tokenizer"
)

func TestProbeEntryKeys(t *testing.T) {
	if err := tokenizer.Init(&tokenizer.PoolConfig{
		MinSize: 1, MaxSize: 1,
		IdleTimeout:    5 * time.Second,
		AcquireTimeout: 5 * time.Second,
	}); err != nil {
		t.Skipf("tokenizer unavailable: %v", err)
	}
	defer tokenizer.Close()

	qb := NewQueryBuilder()
	qb.synonym = NewSynonymWithLoader(nil, "", "", nil)
	tok := tokenizer.New("Chinese")

	entries := []string{
		"基金是怎么买", "基金是怎么买的？", "买基金", "想买基金", "申购费率", "赎回基金多久到账",
	}
	for _, e := range entries {
		lower := strings.ToLower(qb.StrFullWidth2HalfWidth(qb.AddSpaceBetweenEngZh(e)))
		noPunct := rePunct.ReplaceAllString(qb.Traditional2Simplified(lower), " ")
		rmwww := qb.RmWWW(noPunct)
		segs := qb.termWeight.Split(rmwww)
		tokenized, _ := tok.Tokenize(rmwww)
		_, kw := qb.Question(e, "qa", 0, "Chinese")
		fmt.Printf("\n词条 %q\n  去标点=%q 去停用词=%q\n  Split=%v\n  Tokenize=%q\n  Question.keywords=%v\n",
			e, noPunct, rmwww, segs, tokenized, kw)
	}
	_ = context.Background()
}
