// Shiki 单例：懒加载常用语言，避免阻塞首屏
// 调用方：CodeBlock / DiffBlock。失败回退纯文本，不抛错。
import type { Highlighter, ThemedToken, BuiltinLanguage } from "shiki";

let highlighterPromise: Promise<Highlighter | null> | null = null;

// 预加载：开发高频 + Claude 输出常见语言。其余按需 loadLang。
const PRELOAD_LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "bash",
  "python",
  "go",
  "css",
  "html",
  "markdown",
  "yaml",
  "sql",
  "rust",
  "java",
  "shell",
];

const THEME = "github-dark";

const ALIAS: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  rb: "ruby",
  rs: "rust",
  md: "markdown",
  yml: "yaml",
  "c++": "cpp",
  cc: "cpp",
  h: "cpp",
};

export function resolveLang(raw: string | undefined | null): string {
  const lower = String(raw || "").trim().toLowerCase().replace(/^language-/, "");
  if (!lower) return "";
  return ALIAS[lower] || lower;
}

export function getHighlighter(): Promise<Highlighter | null> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki")
      .then((mod) =>
        mod.createHighlighter({
          themes: [THEME],
          langs: PRELOAD_LANGS,
        }),
      )
      .catch((err) => {
        // 加载失败不致命：调用方回退纯文本
        console.warn("[shiki] load failed", err);
        return null;
      });
  }
  return highlighterPromise;
}

// 按需加载未预加载的语言（例如 diff/regexp/dockerfile）。失败回退 null。
export async function ensureLang(lang: string): Promise<boolean> {
  if (!lang) return false;
  const h = await getHighlighter();
  if (!h) return false;
  if (h.getLoadedLanguages().includes(lang)) return true;
  try {
    await h.loadLanguage(lang as never);
    return true;
  } catch {
    return false;
  }
}

// 单行 token 化（DiffBlock 用）。返回 token 数组或 null（不支持/未加载）。
export async function tokenizeLine(
  code: string,
  lang: string,
): Promise<ThemedToken[] | null> {
  if (!lang) return null;
  const h = await getHighlighter();
  if (!h) return null;
  if (!h.getLoadedLanguages().includes(lang)) {
    const ok = await ensureLang(lang);
    if (!ok) return null;
  }
  try {
    const result = h.codeToTokens(code, { lang: lang as BuiltinLanguage, theme: THEME });
    // 单行：tokens[0] 是第一行的 token 数组
    return result.tokens[0] || null;
  } catch {
    return null;
  }
}

// 整段 token 化（CodeBlock 用）。返回按行分组的 token 数组，或 null。
export async function tokenizeCode(
  code: string,
  lang: string,
): Promise<ThemedToken[][] | null> {
  if (!lang) return null;
  const h = await getHighlighter();
  if (!h) return null;
  if (!h.getLoadedLanguages().includes(lang)) {
    const ok = await ensureLang(lang);
    if (!ok) return null;
  }
  try {
    const result = h.codeToTokens(code, { lang: lang as BuiltinLanguage, theme: THEME });
    return result.tokens;
  } catch {
    return null;
  }
}

export const SHIKI_THEME = THEME;
export type { ThemedToken };
