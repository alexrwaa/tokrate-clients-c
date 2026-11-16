#!/usr/bin/env node
/**
 * Tokrate-CN 汉化覆盖率审计（只读）。
 *
 * 扫描 desktop/ui 下的 .tsx/.ts，跳过 desktop/ui/i18n/** 与测试文件，找出仍然硬编码在
 * 界面里的文案：
 *   1. JSX 文本节点（>文字<）；
 *   2. aria-label / aria-description / title / placeholder / alt 属性里的字符串。
 *
 * 输出：按文件统计的清单 + 总数 + 中英文占比 + 是否已接入 i18n（t( / useTranslation / i18n 导入）。
 * 该脚本不修改任何源码，只打印结果和可选 JSON。
 *
 * 用法：
 *   node desktop/scripts/i18n-coverage-audit.mjs
 *   node desktop/scripts/i18n-coverage-audit.mjs --json
 *   node desktop/scripts/i18n-coverage-audit.mjs --root desktop/ui --top 20
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(scriptDir, "..", "..");

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const rootIndex = args.indexOf("--root");
const uiRoot = rootIndex >= 0 && args[rootIndex + 1]
  ? join(repoRoot, args[rootIndex + 1])
  : join(repoRoot, "desktop", "ui");
const topIndex = args.indexOf("--top");
const topLimit = topIndex >= 0 && Number(args[topIndex + 1]) > 0
  ? Number(args[topIndex + 1])
  : 15;

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN_WORD = /[A-Za-z]{2,}/;
const UI_TEXT_ATTRS = [
  "aria-label", "aria-description", "aria-placeholder",
  "title", "placeholder", "alt",
  // 本项目很多可见文案通过组件 props 传入（label/hint/description），同样需要汉化。
  "label", "hint", "description",
];

/** 测试文件不算界面文案。 */
function isSourceFile(name) {
  return /\.(tsx|ts)$/.test(name) && !/\.test\.(tsx|ts)$/.test(name);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // i18n 资源目录按约定排除；node_modules 等构建产物也不会在 ui 下，但仍防御一次。
      if (entry === "i18n" || entry === "node_modules" || entry === "dist") continue;
      walk(full, out);
    } else if (isSourceFile(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** 去掉行注释与块注释，避免把注释里的示例文字计入。 */
function stripComments(source) {
  let out = "";
  let i = 0;
  let state = "code"; // code | line | block | single | double | template
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") { state = "line"; i += 2; continue; }
      if (ch === "/" && next === "*") { state = "block"; i += 2; continue; }
      if (ch === "'") { state = "single"; out += ch; i++; continue; }
      if (ch === '"') { state = "double"; out += ch; i++; continue; }
      if (ch === "`") { state = "template"; out += ch; i++; continue; }
      out += ch; i++; continue;
    }
    if (state === "line") {
      if (ch === "\n") { state = "code"; out += ch; }
      i++; continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") { state = "code"; i += 2; continue; }
      if (ch === "\n") out += ch;
      i++; continue;
    }
    // 字符串内部：原样保留，但处理转义
    if (ch === "\\") { out += ch + (next ?? ""); i += 2; continue; }
    if (state === "single" && ch === "'") state = "code";
    else if (state === "double" && ch === '"') state = "code";
    else if (state === "template" && ch === "`") state = "code";
    out += ch; i++;
  }
  return out;
}

/**
 * 判断一段“候选文本”是否其实是代码（比较运算、箭头函数、逻辑运算等），
 * 用于压掉 `now - 7 * DAY && at < x` 这类被 `>`/`<` 误判的表达式。
 */
function looksLikeCode(text) {
  return (
    /[=&|;]|=>|\+\+|--/.test(text) ||
    /^(const|let|var|return|import|export|function|if|else|for|while|type|interface|class)\b/.test(text) ||
    /[{}()[\]]/.test(text)
  );
}

/** 属性里的硬编码文案。JSX 表达式（{...}）不算。 */
function attributeStrings(source, line) {
  const found = [];
  for (const attr of UI_TEXT_ATTRS) {
    const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, "g");
    let m;
    while ((m = re.exec(source)) !== null) {
      const value = (m[2] ?? m[3] ?? "").trim();
      if (!value) continue;
      if (!CJK.test(value) && !LATIN_WORD.test(value)) continue;
      if (looksLikeCode(value)) continue;
      found.push({ kind: "attribute", name: attr, text: value, line });
    }
  }
  return found;
}

/**
 * JSX 文本节点。两类：
 *  - 同一行 `>文字<`；
 *  - 独占一行的纯文本（多行文本节点）。
 * 纯文本行要求不含代码符号，降低误报。
 */
function jsxTextStrings(source, line, inJsxText) {
  const found = [];
  const inline = /(?:^|[^=])>([^<>{}]*?)</g;
  let m;
  while ((m = inline.exec(source)) !== null) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (!CJK.test(text) && !LATIN_WORD.test(text)) continue;
    if (looksLikeCode(text)) continue;
    found.push({ kind: "jsx-text", name: null, text, line });
  }

  if (inJsxText) {
    const text = source.trim();
    const looksLikeCodeLine = looksLikeCode(text) ||
      /[<>]|^(const|let|var|return|import|export|function|if|else|for|while|type|interface|class|use[A-Z])\b/.test(text);
    const isComment = text.startsWith("//") || text.startsWith("*") || text.startsWith("/*");
    const isClosingTag = /^<\/?[A-Za-z][^>]*\/?>$/.test(text);
    if (text && !looksLikeCodeLine && !isComment && !isClosingTag && (CJK.test(text) || LATIN_WORD.test(text))) {
      found.push({ kind: "jsx-text", name: null, text, line });
    }
  }
  return found;
}

function auditFile(full) {
  const raw = readFileSync(full, "utf8");
  const source = stripComments(raw);
  const lines = source.split(/\r?\n/);
  const items = [];
  let inJsxText = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    items.push(...attributeStrings(line, i + 1));
    // 上一行以 `>` 结尾（开启元素）时，本行可能是多行文本节点。
    items.push(...jsxTextStrings(line, i + 1, inJsxText));
    const trimmed = line.trim();
    inJsxText = /[^/]>\s*$/.test(trimmed) && !/\/>\s*$/.test(trimmed) && !trimmed.includes("{");
  }

  const usesI18n = /\bt\s*\(|useTranslation|from\s+["'][^"']*i18n/.test(source);
  const chinese = items.filter((item) => CJK.test(item.text)).length;
  const english = items.filter((item) => !CJK.test(item.text) && LATIN_WORD.test(item.text)).length;

  return {
    file: relative(repoRoot, full).split(sep).join("/"),
    usesI18n,
    total: items.length,
    chinese,
    english,
    items,
  };
}

const files = walk(uiRoot).sort();
const results = files.map(auditFile).filter((result) => result.total > 0);
const allItems = results.flatMap((result) => result.items);
const total = allItems.length;
const chinese = allItems.filter((item) => CJK.test(item.text)).length;
const english = total - chinese;
const i18nFiles = results.filter((result) => result.usesI18n).length;

const report = {
  scannedFiles: files.length,
  filesWithHardcodedText: results.length,
  filesUsingI18n: i18nFiles,
  totalHardcodedStrings: total,
  chineseStrings: chinese,
  englishStrings: english,
  byFile: results.map(({ items, ...rest }) => ({ ...rest, sample: items.slice(0, 5).map((item) => `${item.line}: ${item.text}`) })),
};

if (jsonMode) {
  console.log(JSON.stringify({ ...report, items: allItems }, null, 2));
  process.exit(0);
}

const pad = (value, width) => String(value).padStart(width, " ");
console.log("Tokrate-CN 汉化覆盖率审计（只读）");
console.log(`扫描目录：${relative(repoRoot, uiRoot).split(sep).join("/")}（${files.length} 个 .ts/.tsx，已排除 i18n/** 与 *.test.*）`);
console.log("");
console.log("文件                                              文案数  中文  英文  i18n");
console.log("------------------------------------------------  ------  ----  ----  ----");
for (const result of results) {
  const name = result.file.length > 48 ? `…${result.file.slice(-47)}` : result.file;
  console.log(
    `${name.padEnd(48)}  ${pad(result.total, 6)}  ${pad(result.chinese, 4)}  ${pad(result.english, 4)}  ${result.usesI18n ? "yes" : "no"}`,
  );
}
console.log("------------------------------------------------  ------  ----  ----  ----");
console.log(
  `合计${" ".repeat(44)}  ${pad(total, 6)}  ${pad(chinese, 4)}  ${pad(english, 4)}`,
);
console.log("");
console.log(`含硬编码文案的文件：${results.length} / ${files.length}`);
console.log(`已接入 i18n 的文件：${i18nFiles} / ${files.length}`);
console.log(
  total === 0
    ? "结论：未发现硬编码文案。"
    : `结论：仍有 ${total} 处硬编码文案（英文 ${english}、中文 ${chinese}），其中 ${results.length} 个文件需要迁移到 t()。`,
);

const top = [...report.byFile].sort((a, b) => b.total - a.total).slice(0, topLimit);
console.log("");
console.log(`文案最多的 ${top.length} 个文件：`);
for (const result of top) {
  console.log(`  ${result.total.toString().padStart(4)}  ${result.file}`);
  for (const item of result.sample) {
    console.log(`        L${item}`);
  }
}
