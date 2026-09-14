import type { DirSpec, PageMeta, TreeNode } from "../types.js";
import { compareNatural } from "../util.js";

interface LevelInput {
  segments: string[];
  meta: PageMeta;
}

interface LevelResult {
  selfIndex: PageMeta | undefined;
  children: TreeNode[];
}

/**
 * 単一ディレクトリレベルのツリーを再帰的に構築する。
 * 各ディレクトリの README.md / index.md はそのディレクトリの「自分自身」を表すため、
 * 兄弟一覧には含めず、ノードの href として親から参照させる（§3.3・§7.4）。
 */
function buildLevel(inputs: LevelInput[]): LevelResult {
  const filesHere = inputs.filter((i) => i.segments.length === 1);
  const selfIndexInput = filesHere.find((f) => f.meta.isIndex);
  const otherFiles = filesHere.filter((f) => f !== selfIndexInput);

  const subGroups = new Map<string, LevelInput[]>();
  for (const inp of inputs) {
    if (inp.segments.length > 1) {
      const [head, ...rest] = inp.segments;
      const key = head!;
      const arr = subGroups.get(key) ?? [];
      arr.push({ segments: rest, meta: inp.meta });
      subGroups.set(key, arr);
    }
  }

  interface Entry {
    sortOrder: number | undefined;
    sortName: string;
    node: TreeNode;
  }
  const entries: Entry[] = [];

  for (const f of otherFiles) {
    entries.push({
      sortOrder: f.meta.order,
      sortName: f.meta.title,
      node: { title: f.meta.title, href: `/${f.meta.outputRelPath}`, children: [], isIndex: false },
    });
  }

  for (const [dirName, subInputs] of subGroups) {
    const { selfIndex, children } = buildLevel(subInputs);
    entries.push({
      sortOrder: selfIndex?.order,
      sortName: selfIndex?.title ?? dirName,
      node: {
        title: selfIndex?.title ?? dirName,
        href: selfIndex ? `/${selfIndex.outputRelPath}` : undefined,
        children,
        isIndex: false,
      },
    });
  }

  entries.sort((a, b) => {
    if (a.sortOrder !== undefined && b.sortOrder !== undefined && a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    if (a.sortOrder !== undefined && b.sortOrder === undefined) return -1;
    if (a.sortOrder === undefined && b.sortOrder !== undefined) return 1;
    return compareNatural(a.sortName, b.sortName);
  });

  return { selfIndex: selfIndexInput?.meta, children: entries.map((e) => e.node) };
}

/**
 * サイドバー全体のツリーを構築する。
 * ルートREADME（有効時）を先頭固定し、--dir ごとに1セクション（見出しはラベル）を並べる（§3.3）。
 */
export function buildTree(pageMetas: PageMeta[], dirs: DirSpec[]): TreeNode[] {
  const nodes: TreeNode[] = [];

  const rootReadme = pageMetas.find((p) => p.dirIndex === -1);
  if (rootReadme) {
    nodes.push({ title: rootReadme.title, href: `/${rootReadme.outputRelPath}`, children: [], isIndex: true });
  }

  dirs.forEach((dir, dirIndex) => {
    const prefix = dir.path === "" ? "" : `${dir.path}/`;
    const inputs: LevelInput[] = pageMetas
      .filter((p) => p.dirIndex === dirIndex)
      .map((meta) => ({
        segments: meta.relPath.startsWith(prefix)
          ? meta.relPath.slice(prefix.length).split("/")
          : meta.relPath.split("/"),
        meta,
      }));

    const { selfIndex, children } = buildLevel(inputs);
    nodes.push({
      title: dir.label,
      href: selfIndex ? `/${selfIndex.outputRelPath}` : undefined,
      children,
      isIndex: false,
    });
  });

  return nodes;
}
