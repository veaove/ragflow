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

import { Operator } from '@/constants/agent';
import { RAGFlowNodeType } from '@/interfaces/database/agent';
import AudioChunkerForm from '@/pages/agent/form/audio-chunker-form';
import CompilationForm from '@/pages/agent/form/compilation-form';
import ExtractorForm from '@/pages/agent/form/extractor-form';
import ParserForm from '@/pages/agent/form/parser-form';
import TitleChunkerForm from '@/pages/agent/form/title-chunker-form';
import TokenChunkerForm from '@/pages/agent/form/token-chunker-form';
import TokenizerForm from '@/pages/agent/form/tokenizer-form';
import { getOperatorType } from '@/utils/pipeline-operator';
import { memo, useCallback } from 'react';
import { FieldErrors } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

type PipelineOperatorFormProps = {
  node: RAGFlowNodeType;
  onValuesChange?: (values: any) => void;
  externalErrors?: FieldErrors;
  // Dataset-side embeddings show a fixed set of parser file types; only the
  // canvas parser allows add/remove.
  fixedFileFormats?: boolean;
};

// Derive the built-in parser name from the chunker node name, e.g.
// "Table Chunker" -> "Table".
function getBuiltinParserName(node: RAGFlowNodeType): string {
  return String(node.data?.name ?? '').replace(/\s*Chunker$/, '');
}

// The Audio pipeline builds its chunker from OneChunker and names the node
// "Audio Chunker". Only that variant exposes a token budget worth editing: an
// ASR transcript easily exceeds one chunk, while the Picture/One variants rely
// on the one-chunk-per-file mapping (splitting would detach the image).
function isAudioChunker(node: RAGFlowNodeType): boolean {
  const parserName = getBuiltinParserName(node);
  return (
    parserName.toLowerCase().includes('audio') || parserName.includes('音频')
  );
}

const PipelineOperatorForm = ({
  node,
  onValuesChange,
  externalErrors,
  fixedFileFormats,
}: PipelineOperatorFormProps) => {
  const { t } = useTranslation();

  const operatorType = getOperatorType(
    (node.data as Record<string, any>)?.operatorId || node.data?.label || '',
  );

  const handleValuesChange = useCallback(
    (values: any) => {
      onValuesChange?.(values);
    },
    [onValuesChange],
  );

  switch (operatorType) {
    case Operator.Parser:
      return (
        <ParserForm
          node={node}
          onValuesChange={handleValuesChange}
          hideOutputs
          externalErrors={externalErrors}
          fixedFileFormats={fixedFileFormats}
        />
      );
    case Operator.TokenChunker:
      return (
        <TokenChunkerForm
          node={node}
          onValuesChange={handleValuesChange}
          hideOutputs
          externalErrors={externalErrors}
        />
      );
    case Operator.GeneralChunker:
      return (
        <TokenChunkerForm
          node={node}
          onValuesChange={handleValuesChange}
          hideOutputs
          externalErrors={externalErrors}
          isGeneralChunker
        />
      );
    case Operator.TitleChunker:
      return (
        <TitleChunkerForm
          node={node}
          onValuesChange={handleValuesChange}
          hideOutputs
          externalErrors={externalErrors}
        />
      );
    case Operator.ManualChunker:
      // The backend pins ManualChunker to the title chunker's "group" method
      // (manual.go) and ignores its token cap, so expose only the rules.
      return (
        <TitleChunkerForm
          node={node}
          onValuesChange={handleValuesChange}
          hideOutputs
          externalErrors={externalErrors}
          pinMethodGroup
        />
      );
    case Operator.Extractor:
      return (
        <ExtractorForm
          node={node}
          onValuesChange={handleValuesChange}
          hideOutputs
          externalErrors={externalErrors}
        />
      );
    case Operator.Compiler:
      return (
        <CompilationForm
          node={node}
          onValuesChange={handleValuesChange}
          hideOutputs
          externalErrors={externalErrors}
        />
      );
    case Operator.Tokenizer:
      return (
        <TokenizerForm
          node={node}
          onValuesChange={handleValuesChange}
          hideOutputs
          externalErrors={externalErrors}
        />
      );
    case Operator.TableChunker:
    case Operator.QAChunker:
    case Operator.PageChunker:
      // These chunkers have no configurable parameters — the built-in parser
      // handles chunking internally.
      return (
        <div className="p-4 text-sm text-text-secondary">
          {t('knowledgeConfiguration.noConfigChunkerHint', {
            name: getBuiltinParserName(node),
          })}
        </div>
      );
    case Operator.OneChunker:
      // OneChunker serves the Audio, Picture and One pipelines. Only Audio
      // gets a form: its transcript is long enough to need a token budget,
      // while the other two keep the one-chunk-per-file behaviour.
      if (isAudioChunker(node)) {
        return (
          <AudioChunkerForm
            node={node}
            onValuesChange={handleValuesChange}
            hideOutputs
            externalErrors={externalErrors}
          />
        );
      }
      return (
        <div className="p-4 text-sm text-text-secondary">
          {t('knowledgeConfiguration.noConfigChunkerHint', {
            name: getBuiltinParserName(node),
          })}
        </div>
      );
    default:
      return null;
  }
};

export default memo(PipelineOperatorForm);
