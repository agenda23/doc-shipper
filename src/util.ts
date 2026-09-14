import { createHash } from "node:crypto";
import path from "node:path";

/** OS依存のパス区切りを posix (`/`) に統一する */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** ルートからの相対 posix パスを返す（先頭・末尾スラッシュなし） */
export function relPosix(root: string, absPath: string): string {
  return toPosix(path.relative(root, absPath));
}

const COMBINING_MARKS_RE = /[̀-ͯ]/g;

/**
 * デプロイ名用の DNS セーフな slug に変換する（小文字英数とハイフン、63文字以内）。
 * 先頭・末尾のハイフンは除去し、連続ハイフンは1つにまとめる。
 */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(COMBINING_MARKS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return (slug || "site").slice(0, 63).replace(/-+$/g, "");
}

/**
 * ファイル名の自然順ソート用キーを生成する。
 * 数値プレフィックスを考慮し "10-x" が "2-x" の後に来るようにする。
 */
export function naturalSortKey(name: string): (string | number)[] {
  return name
    .split(/(\d+)/)
    .filter((part) => part !== "")
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

export function compareNatural(a: string, b: string): number {
  const ka = naturalSortKey(a);
  const kb = naturalSortKey(b);
  const len = Math.max(ka.length, kb.length);
  for (let i = 0; i < len; i++) {
    const va = ka[i];
    const vb = kb[i];
    if (va === undefined) return -1;
    if (vb === undefined) return 1;
    if (typeof va === "number" && typeof vb === "number") {
      if (va !== vb) return va - vb;
    } else {
      const sa = String(va);
      const sb = String(vb);
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

/** ファイル内容の SHA-256 先頭8桁（16進）を返す */
export function contentHash8(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 8);
}

const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
]);

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

/** 外部URL・data URI・メール/電話スキーム等、書き換え対象外の href かどうか */
export function isExternalHref(pathPart: string): boolean {
  if (pathPart.startsWith("//")) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(pathPart);
}

export interface SplitHref {
  pathPart: string;
  query: string;
  hash: string;
}

export function isIndexBasename(basename: string): boolean {
  const lower = basename.toLowerCase();
  return lower === "readme.md" || lower === "index.md";
}

/**
 * ソースの root相対posixパスから出力(html)の root相対posixパスを求める。
 * 出力構造はリポジトリ構造をそのまま保持するため、拡張子の付け替えのみで完結する（§3.1・§7.1）。
 */
export function toOutputRelPath(srcRelPath: string): string {
  const dir = path.posix.dirname(srcRelPath);
  const basename = path.posix.basename(srcRelPath);
  const outBasename = isIndexBasename(basename) ? "index.html" : basename.replace(/\.md$/i, ".html");
  return dir === "." ? outBasename : `${dir}/${outBasename}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** href を path?query#fragment に分解する（フラグメント・クエリはそのまま保持する） */
export function splitHref(href: string): SplitHref {
  const hashIdx = href.indexOf("#");
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : "";
  const withoutHash = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const queryIdx = withoutHash.indexOf("?");
  const query = queryIdx >= 0 ? withoutHash.slice(queryIdx) : "";
  const pathPart = queryIdx >= 0 ? withoutHash.slice(0, queryIdx) : withoutHash;
  return { pathPart, query, hash };
}
