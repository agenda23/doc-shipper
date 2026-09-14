import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildResult, PageMeta, ResolvedOptions, TreeNode, Warning } from "../types.js";
import { escapeHtml, isIndexBasename, toOutputRelPath } from "../util.js";
import { collectDocs } from "./collector.js";
import { renderMarkdown } from "./parser.js";
import { Resolver } from "./resolver.js";
import { buildTree } from "./tree.js";

const require = createRequire(import.meta.url);
const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

async function ensureWriteFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function ensureCopyFile(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
}

function renderTreeHtml(nodes: TreeNode[], currentHref: string, keyPrefix: string): string {
  const items = nodes
    .map((node, i) => {
      const key = `${keyPrefix}${i}`;
      const isCurrent = node.href === currentHref;
      const hasChildren = node.children.length > 0;
      const toggleHtml = hasChildren
        ? `<button type="button" class="tree-toggle" aria-label="開閉" data-key="${escapeHtml(key)}">▾</button>`
        : `<span class="tree-toggle tree-toggle-spacer">▾</span>`;
      const linkHtml = node.href
        ? `<a class="tree-link" href="${escapeHtml(node.href)}">${escapeHtml(node.title)}</a>`
        : `<span class="tree-link">${escapeHtml(node.title)}</span>`;
      const childrenHtml = hasChildren
        ? `<ul class="tree-children">${renderTreeHtml(node.children, currentHref, `${key}-`)}</ul>`
        : "";
      return `<li class="tree-node${isCurrent ? " is-current" : ""}" data-key="${escapeHtml(key)}"><div class="tree-row">${toggleHtml}${linkHtml}</div>${childrenHtml}</li>`;
    })
    .join("");
  return items;
}

/** ツリーの並び順で最初に見つかる href を返す（DFS）。README無効時のリダイレクト先決定に使う（§3.1・§7.11） */
function findFirstHref(nodes: TreeNode[]): string | undefined {
  for (const node of nodes) {
    if (node.href) return node.href;
    const child = findFirstHref(node.children);
    if (child) return child;
  }
  return undefined;
}

function redirectPageHtml(target: string, siteTitle: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}" />
<link rel="canonical" href="${escapeHtml(target)}" />
<title>${escapeHtml(siteTitle)}</title>
</head>
<body>
<p><a href="${escapeHtml(target)}">${escapeHtml(siteTitle)} を開く</a></p>
</body>
</html>
`;
}

/**
 * ドキュメント収集からHTML静的サイト生成までの一連のパイプラインを実行する（§5.1）。
 * 成果物は必ず OS 一時ディレクトリに生成する（§6.3・§7.10）。呼び出し元が cleanup を担う。
 */
export async function build(opts: ResolvedOptions): Promise<BuildResult> {
  const warnings: Warning[] = [];
  const docs = await collectDocs(opts, warnings);
  const resolver = new Resolver(opts.root, docs, warnings);

  const renderedByRelPath = new Map<string, { html: string; firstH1: string | undefined }>();
  for (const doc of docs) {
    renderedByRelPath.set(doc.relPath, await renderMarkdown(doc, resolver));
  }

  // §3.2・§7.3: --strict 指定時は未解決リンク/パストラバーサル等の警告をエラーとして扱う。
  // marked の walkTokens 内で即座に例外を投げると marked 独自のエラーラップ（"Please report this to marked"）に
  // 巻き込まれて誤解を招くため、全ドキュメント処理後にまとめて判定する。
  if (opts.strict && warnings.length > 0) {
    const details = warnings.map((w) => `  - [${w.file}] ${w.message}`).join("\n");
    throw new Error(`[--strict] 未解決の参照が${warnings.length}件見つかりました:\n${details}`);
  }

  const pageMetas: PageMeta[] = docs.map((doc) => {
    const basename = path.posix.basename(doc.relPath);
    const isIndex = isIndexBasename(basename) || doc.dirIndex === -1;
    const fm = doc.frontmatter;
    const fmTitle = typeof fm.title === "string" ? fm.title : undefined;
    const firstH1 = renderedByRelPath.get(doc.relPath)?.firstH1;
    const fallbackTitle = path.posix.basename(doc.relPath, path.extname(doc.relPath));
    const order = typeof fm.order === "number" ? fm.order : undefined;
    return {
      relPath: doc.relPath,
      outputRelPath: toOutputRelPath(doc.relPath),
      dirIndex: doc.dirIndex,
      title: fmTitle ?? firstH1 ?? fallbackTitle,
      order,
      isIndex,
    };
  });

  const tree = buildTree(pageMetas, opts.dirs);

  const outDir = await mkdtemp(path.join(os.tmpdir(), "doc-shipper-"));

  for (const doc of docs) {
    const meta = pageMetas.find((p) => p.relPath === doc.relPath)!;
    const rendered = renderedByRelPath.get(doc.relPath)!;
    const currentHref = `/${meta.outputRelPath}`;
    const sidebarHtml = `<ul class="tree-children tree-root">${renderTreeHtml(tree, currentHref, "n")}</ul>`;
    const pageHtml = await renderLayout({
      pageTitle: `${meta.title} - ${opts.title}`,
      siteTitle: opts.title,
      currentHref,
      sidebarHtml,
      bodyHtml: rendered.html,
    });
    await ensureWriteFile(path.join(outDir, meta.outputRelPath), pageHtml);
  }

  const hasRootIndex = pageMetas.some((p) => p.outputRelPath === "index.html");
  if (!hasRootIndex) {
    const target = findFirstHref(tree) ?? "/";
    await ensureWriteFile(path.join(outDir, "index.html"), redirectPageHtml(target, opts.title));
  }

  let imageCount = 0;
  let fileCount = 0;
  for (const asset of resolver.assets) {
    await ensureCopyFile(asset.sourceAbsPath, path.join(outDir, asset.outputHref.replace(/^\//, "")));
    if (asset.kind === "image") imageCount++;
    else fileCount++;
  }

  await ensureCopyFile(path.join(TEMPLATES_DIR, "styles.css"), path.join(outDir, "assets/styles.css"));
  await ensureCopyFile(path.join(TEMPLATES_DIR, "sidebar.js"), path.join(outDir, "assets/sidebar.js"));

  const markdownCssPath = require.resolve("github-markdown-css/github-markdown.css");
  await ensureCopyFile(markdownCssPath, path.join(outDir, "assets/github-markdown.css"));

  return {
    outDir,
    pageCount: docs.length,
    imageCount,
    fileCount,
    warnings,
  };
}

let layoutTemplateCache: string | undefined;

async function renderLayout(params: {
  pageTitle: string;
  siteTitle: string;
  currentHref: string;
  sidebarHtml: string;
  bodyHtml: string;
}): Promise<string> {
  if (!layoutTemplateCache) {
    layoutTemplateCache = await readFile(path.join(TEMPLATES_DIR, "layout.html"), "utf8");
  }
  return layoutTemplateCache
    .replaceAll("__PAGE_TITLE__", escapeHtml(params.pageTitle))
    .replaceAll("__SITE_TITLE__", escapeHtml(params.siteTitle))
    .replaceAll("__CURRENT_HREF__", escapeHtml(params.currentHref))
    .replace("__SIDEBAR_HTML__", params.sidebarHtml)
    .replace("__BODY_HTML__", params.bodyHtml);
}
