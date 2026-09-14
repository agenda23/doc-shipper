import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import type { RawDoc, ResolvedOptions, Warning } from "../types.js";
import { relPosix } from "../util.js";

/**
 * .md 収集時の既定除外パターン（§8.4）。
 * node_modules / .git / 隠しディレクトリ配下、および .doc-shipper.json 自体を除く。
 * --dir に明示指定されたパス自体（cwd相当）は対象外にならない。
 */
const EXCLUDE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.*/**",
  ".doc-shipper.json",
];

/**
 * 指定ディレクトリ群 + (有効なら) ルートREADME から .md を収集し、
 * フロントマター抽出・出力パス基準での重複排除を行う。
 */
export async function collectDocs(
  opts: ResolvedOptions,
  warnings: Warning[],
): Promise<RawDoc[]> {
  const found: RawDoc[] = [];

  for (let dirIndex = 0; dirIndex < opts.dirs.length; dirIndex++) {
    const dir = opts.dirs[dirIndex]!;
    const absDir = path.join(opts.root, dir.path);
    const matches = await fg("**/*.md", {
      cwd: absDir,
      ignore: EXCLUDE_GLOBS,
      caseSensitiveMatch: true,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
    });

    for (const m of matches) {
      const absPath = path.join(absDir, m);
      const relPath = relPosix(opts.root, absPath);
      const raw = await readFile(absPath, "utf8");
      const { data, content } = matter(raw);
      found.push({
        absPath,
        relPath,
        dirIndex,
        frontmatter: data ?? {},
        content,
      });
    }
  }

  if (opts.includeReadme) {
    const rootReadme = path.join(opts.root, "README.md");
    try {
      const raw = await readFile(rootReadme, "utf8");
      const { data, content } = matter(raw);
      found.push({
        absPath: rootReadme,
        relPath: "README.md",
        dirIndex: -1,
        frontmatter: data ?? {},
        content,
      });
    } catch {
      // ルートに README.md が無ければ無視（builder 側がリダイレクトページを生成する）
    }
  }

  return dedupeByOutputPath(found, warnings);
}

/**
 * 出力パス基準で重複排除する（§3.1・§7.1）。
 * - 親子ディレクトリ同時指定などで全く同じ相対パスが重複した場合は先勝ちで単純に間引く。
 * - 大文字小文字のみが異なり同一出力パスに衝突する場合はエラーとする（大文字小文字を区別しないファイルシステム対策）。
 */
function dedupeByOutputPath(docs: RawDoc[], warnings: Warning[]): RawDoc[] {
  const seenExact = new Map<string, RawDoc>();
  const seenLower = new Map<string, RawDoc>();
  const result: RawDoc[] = [];

  for (const doc of docs) {
    if (seenExact.has(doc.relPath)) {
      // 完全一致（親子ディレクトリの重複指定など）: 先勝ちで無視
      continue;
    }
    const lowerKey = doc.relPath.toLowerCase();
    const clash = seenLower.get(lowerKey);
    if (clash) {
      throw new Error(
        `出力パスが大文字小文字のみの違いで衝突しています: "${clash.relPath}" と "${doc.relPath}"（大文字小文字を区別しないファイルシステムでは同一ファイルとして扱われます）`,
      );
    }
    seenExact.set(doc.relPath, doc);
    seenLower.set(lowerKey, doc);
    result.push(doc);
  }

  return result;
}
