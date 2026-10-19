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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';

import kbService, {
  listDocument,
} from '@/services/knowledge-service';

import type { IChunk } from '@/interfaces/database/dataset';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 10;

/** FAQ chunk 的 content 形如「问题：xxx\t回答：yyy」或「Question: xxx\tAnswer: yyy」。 */
function splitQa(content: string): { question: string; answer: string } {
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

/**
 * SimilarQuestion 是相似问管理页：为每个 FAQ 问答对维护多种用户问法。
 *
 * 相似问存于 chunk.question_kwd，通过 setChunk 更新（后端会同步重算
 * question_tks，使改动真正影响检索）。标准问与答案从 chunk 的
 * content_with_weight 按 TAB 拆分得到。
 */
export default function SimilarQuestion() {
  const { id: datasetId = '' } = useParams();
  const [chunks, setChunks] = useState<IChunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<IChunk | null>(null);

  const reload = useCallback(async () => {
    if (!datasetId) return;
    setLoading(true);
    try {
      // chunk 挂在文档下（GET /datasets/{id}/documents/{doc_id}/chunks），
      // 必须先列文档再逐文档拉 chunk；kbService.chunkList 的 document_id
      // 缺失会拼出 /documents/undefined/chunks 导致 500。
      const docRes = await listDocument({
        id: datasetId,
        page: 1,
        page_size: 1000,
      });
      const docs: Array<{ id: string }> = docRes?.data?.data?.docs ?? [];
      const all: IChunk[] = [];
      for (const doc of docs) {
        const res = await kbService.chunkList({
          dataset_id: datasetId,
          document_id: doc.id,
          page: 1,
          page_size: 1000,
        });
        const chunks: IChunk[] = res?.data?.data?.chunks ?? [];
        all.push(...chunks);
      }
      setChunks(all);
    } catch {
      toast.error('加载问答对失败');
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return chunks;
    return chunks.filter((c) => {
      const { question, answer } = splitQa(c.content_with_weight);
      return (
        question.toLowerCase().includes(kw) ||
        answer.toLowerCase().includes(kw) ||
        (c.question_kwd ?? []).some((q) => q.toLowerCase().includes(kw))
      );
    });
  }, [chunks, keyword]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const openEdit = async (chunk: IChunk) => {
    try {
      const response = await kbService.getChunk({
        dataset_id: datasetId,
        document_id: chunk.doc_id,
        chunk_id: chunk.chunk_id,
      });
      setEditing(response?.data?.data ?? chunk);
    } catch {
      // 详情获取失败时退回到列表项，仍可编辑相似问
      setEditing(chunk);
    }
  };

  const save = async (chunk: IChunk, questions: string[]) => {
    const cleaned = questions.map((q) => q.trim()).filter(Boolean);
    // 同一问答对内去重
    const unique = Array.from(new Set(cleaned));
    try {
      await kbService.setChunk({
        dataset_id: datasetId,
        document_id: chunk.doc_id,
        chunk_id: chunk.chunk_id,
        questions: unique,
      });
      toast.success('相似问已保存');
      setEditing(null);
      reload();
    } catch {
      toast.error('保存失败');
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">相似问管理</h1>
        <p className="mt-1 text-sm text-text-secondary">
          为每个标准问维护多种用户问法，提升检索召回覆盖面。
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Input
          className="w-64"
          placeholder="搜索标准问或相似问"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
        />
        <span className="text-sm text-text-secondary">
          共 {filtered.length} 个问答对
        </span>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-border-base">
        <Table>
          <TableHeader className="bg-background-second">
            <TableRow>
              <TableHead className="h-10 w-52 text-text-title">标准问</TableHead>
              <TableHead className="h-10 text-text-title">答案摘要</TableHead>
              <TableHead className="h-10 w-72 text-text-title">相似问</TableHead>
              <TableHead className="h-10 w-36 text-text-title">来源文档</TableHead>
              <TableHead className="h-10 w-28 text-text-title">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length === 0 && !loading ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-40 text-center text-text-secondary"
                >
                  暂无问答对
                </TableCell>
              </TableRow>
            ) : (
              paged.map((chunk) => {
                const { question, answer } = splitQa(
                  chunk.content_with_weight,
                );
                const similar = chunk.question_kwd ?? [];
                return (
                  <TableRow key={chunk.chunk_id}>
                    <TableCell className="font-medium text-text-title">
                      {question || chunk.doc_name}
                    </TableCell>
                    <TableCell className="max-w-md">
                      <span className="line-clamp-2 text-sm text-text-secondary">
                        {answer}
                      </span>
                    </TableCell>
                    <TableCell>
                      {similar.length === 0 ? (
                        <span className="text-sm text-text-secondary">
                          — 暂无相似问
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {similar.map((q) => (
                            <span
                              key={q}
                              className="rounded bg-bg-card px-1.5 py-0.5 text-xs text-text-primary"
                            >
                              {q}
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-text-secondary">
                      {chunk.doc_name || '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => openEdit(chunk)}
                        >
                          编辑
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {filtered.length > PAGE_SIZE && (
        <RAGFlowPagination
          current={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onChange={setPage}
        />
      )}

      <SimilarEditor
        chunk={editing}
        onClose={() => setEditing(null)}
        onSave={save}
      />
    </div>
  );
}

function SimilarEditor({
  chunk,
  onClose,
  onSave,
}: {
  chunk: IChunk | null;
  onClose: () => void;
  onSave: (chunk: IChunk, questions: string[]) => void;
}) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (chunk) {
      setText((chunk.question_kwd ?? []).join('\n'));
    }
  }, [chunk]);

  const { question, answer } = chunk
    ? splitQa(chunk.content_with_weight)
    : { question: '', answer: '' };

  return (
    <Dialog open={!!chunk} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑相似问</DialogTitle>
        </DialogHeader>

        {chunk && (
          <div className="flex flex-col gap-4">
            <div className="rounded bg-bg-card p-3">
              <div className="mb-1 text-xs text-text-secondary">标准问</div>
              <div className="text-sm font-medium text-text-title">
                {question}
              </div>
            </div>
            <div className="rounded bg-bg-card p-3">
              <div className="mb-1 text-xs text-text-secondary">答案</div>
              <div className="line-clamp-4 text-sm text-text-secondary">
                {answer}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm text-text-secondary">
                相似问
                <span className="ml-1 text-xs text-text-secondary">
                  （每行一条，建议 3~8 条）
                </span>
              </label>
              <textarea
                className="h-40 w-full rounded-md border border-border-base bg-background-content px-3 py-2 text-sm"
                value={text}
                placeholder="工资理财去哪买&#10;在哪买基金"
                onChange={(e) => setText(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button
                onClick={() =>
                  onSave(
                    chunk,
                    text.split('\n').map((s) => s.trim()).filter(Boolean),
                  )
                }
              >
                保存
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
