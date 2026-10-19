/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import {
  type IGenerateCandidate,
  generateSimilarQuestions,
  stageSimilarQuestions,
} from '@/services/change-set-service';
import type { IChunk } from '@/interfaces/database/dataset';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

const DEFAULT_PROMPT = `你是基金行业客服训练师。请针对给定的标准问题与答案，生成若干条用户在真实咨询中可能使用的相似问法。

要求：
1. 口语化，贴近用户真实表达，不要照抄标准问；
2. 覆盖不同说法（如「怎么买」「在哪买」「能不能买」）；
3. 不要改变原意，不要引入答案中没有的信息；
4. 只输出相似问，每行一条，不要编号和解释。`;

/**
 * GenerateDialog 是批量生成相似问向导：输入范围 + 提示词 → 生成候选 → 勾选采纳。
 */
export function GenerateDialog({
  open,
  onOpenChange,
  datasetId,
  chunks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: string;
  chunks: IChunk[];
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [count, setCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [candidates, setCandidates] = useState<IGenerateCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const startGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const items = chunks
        .map((c) => {
          const { question, answer } = splitQaForGenerate(c.content_with_weight);
          return {
            chunk_id: c.chunk_id,
            document_id: c.doc_id,
            question,
            answer,
          };
        })
        .filter((it) => it.question);
      const res = await generateSimilarQuestions(datasetId, {
        items,
        prompt,
        count,
      });
      const cands: IGenerateCandidate[] = res?.data?.data ?? [];
      setCandidates(cands);
      // 默认勾选高置信（有候选的）项
      const sel: Record<string, boolean> = {};
      cands.forEach((c) => {
        c.candidates.forEach((cc) => {
          sel[`${c.chunk_id}::${cc}`] = true;
        });
      });
      setSelected(sel);
      setStep(2);
    } catch (e: any) {
      toast.error(e?.message || '生成失败，请确认已配置默认聊天模型');
    } finally {
      setGenerating(false);
    }
  }, [chunks, datasetId, prompt, count]);

  const adopt = async () => {
    const adopted: IGenerateCandidate[] = candidates
      .map((c) => ({
        ...c,
        candidates: c.candidates.filter(
          (cc) => selected[`${c.chunk_id}::${cc}`],
        ),
      }))
      .filter((c) => c.candidates.length > 0);

    if (adopted.length === 0) {
      toast.error('未勾选任何候选');
      return;
    }

    let total = 0;
    try {
      for (const c of adopted) {
        await stageSimilarQuestions(datasetId, {
          document_id: c.document_id,
          chunk_id: c.chunk_id,
          questions: c.candidates,
          origin: 'llm',
        });
        total += c.candidates.length;
      }
      toast.success(`已采纳 ${total} 条相似问，进入待生效区`);
      onOpenChange(false);
      setStep(1);
    } catch {
      toast.error('采纳失败');
    }
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>批量生成相似问</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="text-sm text-text-secondary">
              基于现有问答 + 提示词生成候选，人工勾选后才进入待生效区（共 {chunks.length} 个问答对）。
            </div>
            <div className="flex gap-3">
              <div className="w-32">
                <label className="mb-1 block text-sm text-text-secondary">
                  每个标准问生成
                </label>
                <select
                  className="h-10 w-full rounded-md border border-border-base bg-background-content px-3 text-sm"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  <option value={3}>3 条</option>
                  <option value={5}>5 条</option>
                  <option value={8}>8 条</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-text-secondary">
                提示词（可修改，仅影响本次生成）
              </label>
              <Textarea
                rows={8}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex max-h-[50vh] flex-col gap-3 overflow-auto">
            {generating ? (
              <div className="py-10 text-center text-text-secondary">
                正在生成相似问，请稍候…
              </div>
            ) : candidates.length === 0 ? (
              <div className="py-10 text-center text-text-secondary">
                无候选结果
              </div>
            ) : (
              candidates.map((c) => (
                <div key={c.chunk_id} className="rounded border border-border-base p-3">
                  <div className="mb-2 text-sm font-medium text-text-title">
                    {c.question}
                  </div>
                  {c.error ? (
                    <div className="text-xs text-state-error">{c.error}</div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {c.candidates.map((cc) => (
                        <label
                          key={cc}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={!!selected[`${c.chunk_id}::${cc}`]}
                            onChange={(e) =>
                              setSelected((prev) => ({
                                ...prev,
                                [`${c.chunk_id}::${cc}`]: e.target.checked,
                              }))
                            }
                          />
                          {cc}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        <DialogFooter>
          {step === 1 && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={startGenerate} disabled={generating || chunks.length === 0}>
                {generating ? '生成中…' : '开始生成'}
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                上一步
              </Button>
              <Button onClick={adopt} disabled={selectedCount === 0}>
                加入待生效变更（{selectedCount} 条）
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function splitQaForGenerate(content: string): { question: string; answer: string } {
  if (!content) return { question: '', answer: '' };
  const idx = content.indexOf('\t');
  if (idx < 0) return { question: content, answer: '' };
  const question = content.slice(0, idx);
  const answer = content.slice(idx + 1);
  return {
    question: question.replace(/^(问题：|Question:\s*)/, '').trim(),
    answer: answer.replace(/^(回答：|Answer:\s*)/, '').trim(),
  };
}
