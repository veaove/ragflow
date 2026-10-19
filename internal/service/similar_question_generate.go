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

package service

import (
	"context"
	"fmt"
	"strings"

	"ragflow/internal/entity/models"

	"github.com/cloudwego/eino/schema"
)

// defaultSimilarQuestionPrompt is the fallback prompt when the caller does not
// override it. The output contract is strict: one question per line, no
// numbering, no explanation.
const defaultSimilarQuestionPrompt = `你是基金行业客服训练师。请针对给定的标准问题与答案，生成若干条用户在真实咨询中可能使用的相似问法。

要求：
1. 口语化，贴近用户真实表达，不要照抄标准问；
2. 覆盖不同说法（如「怎么买」「在哪买」「能不能买」）；
3. 不要改变原意，不要引入答案中没有的信息；
4. 只输出相似问，每行一条，不要编号和解释。`

// SimilarQuestionCandidate is one generated candidate for a chunk.
type SimilarQuestionCandidate struct {
	ChunkID    string   `json:"chunk_id"`
	DocumentID string   `json:"document_id"`
	Question   string   `json:"question"`
	Candidates []string `json:"candidates"`
	Error      string   `json:"error,omitempty"`
}

// GenerateSimilarQuestionsRequest is the body of a batch generation call.
type GenerateSimilarQuestionsRequest struct {
	// Items are the FAQ pairs to generate for. Question is the standard
	// question; Answer is the answer text (used to constrain generation).
	Items    []GenerateSimilarQuestionItem `json:"items"`
	Prompt   string                        `json:"prompt"`
	Count    int                           `json:"count"`
	ModelRef string                        `json:"model_ref"`
}

// GenerateSimilarQuestionItem is one FAQ pair for generation.
type GenerateSimilarQuestionItem struct {
	ChunkID    string `json:"chunk_id"`
	DocumentID string `json:"document_id"`
	Question   string `json:"question"`
	Answer     string `json:"answer"`
}

// GenerateSimilarQuestions generates candidate similar questions for a batch of
// FAQ pairs using the tenant's default chat model. It returns one candidate set
// per item; per-item failures are recorded on the item rather than aborting the
// whole batch.
func (s *ChangeSetService) GenerateSimilarQuestions(ctx context.Context, userID, datasetID string, req GenerateSimilarQuestionsRequest) ([]SimilarQuestionCandidate, error) {
	if len(req.Items) == 0 {
		return nil, fmt.Errorf("no items to generate for")
	}
	tenantID, err := resolveTenantID(ctx, userID, datasetID)
	if err != nil {
		return nil, err
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		prompt = defaultSimilarQuestionPrompt
	}
	count := req.Count
	if count <= 0 {
		count = 3
	}

	factory := NewModelFactory()
	cm, err := factory.NewDefaultChatModel(ctx, ModelAccess{UserID: userID, TenantID: tenantID})
	if err != nil {
		return nil, fmt.Errorf("no default chat model: %w", err)
	}
	eino := models.NewEinoChatModel(cm, nil)

	out := make([]SimilarQuestionCandidate, 0, len(req.Items))
	for _, item := range req.Items {
		q := strings.TrimSpace(item.Question)
		a := strings.TrimSpace(item.Answer)
		if q == "" {
			continue
		}
		userContent := fmt.Sprintf("标准问题：%s\n答案：%s\n请生成 %d 条相似问。", q, a, count)
		if len(a) > 2000 {
			userContent = fmt.Sprintf("标准问题：%s\n答案：%s\n请生成 %d 条相似问。", q, a[:2000], count)
		}
		msgs := []*schema.Message{
			schema.SystemMessage(prompt),
			schema.UserMessage(userContent),
		}
		msg, gerr := eino.Generate(ctx, msgs)
		cand := SimilarQuestionCandidate{
			ChunkID:    item.ChunkID,
			DocumentID: item.DocumentID,
			Question:   q,
		}
		if gerr != nil {
			cand.Error = gerr.Error()
			out = append(out, cand)
			continue
		}
		cand.Candidates = filterCandidateLines(msg.Content, q)
		out = append(out, cand)
	}
	return out, nil
}

// filterCandidateLines splits a raw LLM reply into one question per line,
// trimming blanks and dropping any line identical to the standard question.
func filterCandidateLines(raw, standardQuestion string) []string {
	lines := strings.Split(raw, "\n")
	seen := map[string]bool{}
	out := make([]string, 0, len(lines))
	std := strings.TrimSpace(standardQuestion)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		// Strip a leading numbering like "1." or "1、".
		line = strings.TrimLeft(line, "0123456789.、)） ")
		line = strings.TrimSpace(line)
		if line == "" || line == std || len([]rune(line)) > 100 {
			continue
		}
		if seen[line] {
			continue
		}
		seen[line] = true
		out = append(out, line)
	}
	return out
}
