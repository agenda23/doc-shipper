import { Marked } from "marked";
import { codeToHtml } from "shiki";
import type { RawDoc } from "../types.js";
import type { Resolver } from "./resolver.js";

const SHIKI_THEMES = { light: "github-light", dark: "github-dark" } as const;

/** shiki が知らない/未対応の言語指定を吸収するためのフォールバック */
async function highlight(code: string, lang: string | undefined): Promise<string> {
  const langId = (lang ?? "").trim().split(/\s+/)[0] || "text";
  try {
    return await codeToHtml(code, { lang: langId, themes: SHIKI_THEMES });
  } catch {
    try {
      return await codeToHtml(code, { lang: "text", themes: SHIKI_THEMES });
    } catch {
      const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<pre class="shiki"><code>${escaped}</code></pre>`;
    }
  }
}

const HTML_ATTR_RE = /(src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi;

export interface RenderResult {
  html: string;
  /** 本文最初の H1 テキスト（タイトル決定のフォールバック用。§3.3） */
  firstH1: string | undefined;
}

interface CodeTokenWithHighlight {
  type: "code";
  text: string;
  lang?: string;
  __highlighted?: string;
}

/**
 * marked(async) + walkTokens で shiki ハイライトと resolver によるリンク/アセット書き換えを適用する（§5.1・§7.8）。
 *
 * 注意: marked の Renderer（RendererObject）はカスタムメソッドの戻り値を await しない
 * （`async: true` が待機するのは walkTokens のみ）。そのため shiki のハイライト結果は
 * walkTokens の段階で事前に計算してトークンに埋め込み、renderer.code では同期的に
 * その結果を読み出すだけにする。
 */
export async function renderMarkdown(doc: RawDoc, resolver: Resolver): Promise<RenderResult> {
  let firstH1: string | undefined;

  const marked = new Marked({
    gfm: true, // §8.3: テーブル・タスクリスト・自動リンクのみを対応範囲とする
    async: true,
    async walkTokens(token) {
      if (token.type === "heading" && token.depth === 1 && firstH1 === undefined) {
        firstH1 = token.text;
      }
      if (token.type === "link") {
        const result = resolver.resolveLink(doc.absPath, token.href);
        token.href = result.href;
      } else if (token.type === "image") {
        const result = resolver.resolveAsset(doc.absPath, token.href, "image");
        token.href = result.href;
      } else if (token.type === "code") {
        const codeToken = token as CodeTokenWithHighlight;
        codeToken.__highlighted = await highlight(codeToken.text, codeToken.lang);
      } else if (token.type === "html") {
        // 生HTML（<img src="...">, <a href="...">）はトークン内の raw/text を正規表現で書き換える
        if ("raw" in token && typeof token.raw === "string") {
          const rewritten = rewriteRawHtml(token.raw, doc.absPath, resolver);
          token.raw = rewritten;
          if ("text" in token) (token as { text: string }).text = rewritten;
        }
      }
    },
  });

  marked.use({
    renderer: {
      code(token) {
        const cached = (token as CodeTokenWithHighlight).__highlighted;
        return cached ?? `<pre><code>${token.text}</code></pre>`;
      },
    },
  });

  const html = await marked.parse(doc.content);
  return { html, firstH1 };
}

function rewriteRawHtml(raw: string, fromAbsPath: string, resolver: Resolver): string {
  return raw.replace(HTML_ATTR_RE, (full, attr: string, _quoted, dq, sq) => {
    const value = dq ?? sq ?? "";
    if (value === "") return full;
    const isImgAttr = attr.toLowerCase() === "src";
    const result = isImgAttr
      ? resolver.resolveAsset(fromAbsPath, value, "image")
      : resolver.resolveLink(fromAbsPath, value);
    if (!result.changed) return full;
    const quoteChar = dq !== undefined ? '"' : "'";
    return `${attr}=${quoteChar}${result.href}${quoteChar}`;
  });
}
