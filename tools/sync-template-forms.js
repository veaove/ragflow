#!/usr/bin/env node
/**
 * sync-template-forms.js
 *
 * 把中文模板 .zh.json 里 dsl.components.*.obj.params 中已翻译的中文提示词
 * 同步到 dsl.graph.nodes[].data.form 的同名字段。
 *
 * 仅覆盖"可翻译文本字段"（sys_prompt / prompts[].content / description /
 * user_prompt / tool 节点里的 description），不动 temperature / top_p /
 * model_id / llm_id / max_rounds 等配置字段。
 *
 * 用法：
 *   node tools/sync-template-forms.js                       # 处理全部 *.zh.json
 *   node tools/sync-template-forms.js deep_research.zh.json # 只处理一份
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMPLATES_DIR = join(__dirname, '..', 'internal', 'agent', 'templates');

// 这几个字段是"可翻译文本"，从 components.params 复制到 form
const TEXT_FIELDS = new Set([
  'sys_prompt',
  'description',
  'user_prompt',
]);

function deepMergeInto(target, source, depth = 0) {
  if (target == null || source == null) return target;
  if (typeof target !== 'object' || typeof source !== 'object') return target;
  if (Array.isArray(target) !== Array.isArray(source)) return target;

  if (Array.isArray(target)) {
    // 数组：按索引逐元素合并
    for (let i = 0; i < Math.max(target.length, source.length); i++) {
      if (i >= source.length) break;
      if (i >= target.length) {
        target[i] = source[i];
      } else {
        target[i] = deepMergeInto(target[i], source[i], depth + 1);
      }
    }
    return target;
  }

  for (const key of Object.keys(source)) {
    if (!(key in target)) {
      target[key] = source[key];
      continue;
    }
    const sv = source[key];
    const tv = target[key];
    if (sv == null || typeof sv !== 'object') {
      target[key] = sv;
    } else if (tv != null && typeof tv === 'object') {
      target[key] = deepMergeInto(tv, sv, depth + 1);
    } else {
      target[key] = sv;
    }
  }
  return target;
}

function syncOneForm(form, params) {
  if (!form || !params) return false;
  let changed = false;

  for (const key of TEXT_FIELDS) {
    const src = params[key];
    if (src == null) continue;
    // 只覆盖不同的值
    if (JSON.stringify(form[key]) !== JSON.stringify(src)) {
      form[key] = src;
      changed = true;
    }
  }

  // prompts 数组：逐元素合并，只覆盖 .content 字段
  const srcPrompts = params.prompts;
  if (Array.isArray(srcPrompts)) {
    if (!Array.isArray(form.prompts)) {
      form.prompts = srcPrompts;
      changed = true;
    } else {
      for (let i = 0; i < Math.min(srcPrompts.length, form.prompts.length); i++) {
        const sp = srcPrompts[i];
        const tp = form.prompts[i];
        if (sp && tp && typeof sp === 'object' && typeof tp === 'object') {
          if (sp.content != null && tp.content !== sp.content) {
            tp.content = sp.content;
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}

function processFile(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  // 处理可能的 BOM
  const clean = raw.replace(/^\uFEFF/, '');

  let data;
  try {
    data = JSON.parse(clean);
  } catch (e) {
    console.error(`FAIL: ${filePath}  JSON parse error: ${e.message}`);
    return false;
  }

  const dsl = data.dsl;
  if (!dsl || typeof dsl !== 'object') {
    console.error(`FAIL: ${filePath}  missing dsl object`);
    return false;
  }

  const components = dsl.components || {};
  const graph = dsl.graph;

  if (!graph || !Array.isArray(graph.nodes)) {
    console.warn(`SKIP: ${filePath}  no graph.nodes`);
    return false;
  }

  let changedCount = 0;

  for (const node of graph.nodes) {
    if (!node || typeof node !== 'object') continue;
    const nodeId = node.id;
    const form = node.data?.form;
    const comp = components[nodeId];

    if (!form || !comp) continue;

    const params = comp.obj?.params;
    if (!params) continue;

    if (syncOneForm(form, params)) {
      changedCount++;
    }
  }

  if (changedCount > 0) {
    // 写回：pretty-print，保持原缩进风格（2 空格）
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    console.log(`OK: ${filePath}  synced ${changedCount} node(s)`);
    return true;
  } else {
    console.log(`CLEAN: ${filePath}  already in sync`);
    return true;
  }
}

// --- main ---

const target = process.argv[2];
let files;

if (target) {
  // 指定单个文件
  const p = join(TEMPLATES_DIR, target);
  if (!statSync(p).isFile()) {
    console.error(`File not found: ${p}`);
    process.exit(1);
  }
  files = [p];
} else {
  // 所有 *.zh.json
  files = readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.zh.json'))
    .map((f) => join(TEMPLATES_DIR, f));
}

console.log(`Processing ${files.length} template file(s)...\n`);

let ok = 0, clean = 0, fail = 0;
for (const f of files) {
  const result = processFile(f);
  if (result === true) ok++;
  else if (result === 'clean') clean++;
  else fail++;
}

console.log(`\nDone. changed=${ok}  clean=${clean}  fail=${fail}`);
