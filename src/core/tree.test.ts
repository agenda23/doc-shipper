import { describe, expect, it } from "vitest";
import type { DirSpec, PageMeta } from "../types.js";
import { buildTree } from "./tree.js";

function meta(partial: Partial<PageMeta> & Pick<PageMeta, "relPath" | "outputRelPath" | "dirIndex">): PageMeta {
  return { title: partial.relPath, order: undefined, isIndex: false, ...partial };
}

describe("buildTree", () => {
  const dirs: DirSpec[] = [{ path: "docs/spec", label: "仕様書" }];

  it("pins each directory's README/index as the section/node href instead of listing it as a sibling", () => {
    const metas: PageMeta[] = [
      meta({ relPath: "docs/spec/README.md", outputRelPath: "docs/spec/index.html", dirIndex: 0, isIndex: true, title: "トップ" }),
      meta({ relPath: "docs/spec/auth.md", outputRelPath: "docs/spec/auth.html", dirIndex: 0, title: "認証" }),
    ];
    const tree = buildTree(metas, dirs);
    expect(tree).toHaveLength(1);
    const section = tree[0]!;
    expect(section.title).toBe("仕様書"); // ラベルが常に見出しになる（frontmatterのtitleではない）
    expect(section.href).toBe("/docs/spec/index.html");
    expect(section.children).toHaveLength(1);
    expect(section.children[0]!.title).toBe("認証");
  });

  it("orders siblings by frontmatter order, falling back to natural sort", () => {
    const metas: PageMeta[] = [
      meta({ relPath: "docs/spec/10-z.md", outputRelPath: "docs/spec/10-z.html", dirIndex: 0, title: "10-z" }),
      meta({ relPath: "docs/spec/2-a.md", outputRelPath: "docs/spec/2-a.html", dirIndex: 0, title: "2-a" }),
      meta({ relPath: "docs/spec/1-explicit.md", outputRelPath: "docs/spec/1-explicit.html", dirIndex: 0, title: "explicit-first", order: 0 }),
    ];
    const tree = buildTree(metas, dirs);
    const titles = tree[0]!.children.map((c) => c.title);
    expect(titles).toEqual(["explicit-first", "2-a", "10-z"]);
  });

  it("puts the root README first when present", () => {
    const metas: PageMeta[] = [
      meta({ relPath: "README.md", outputRelPath: "index.html", dirIndex: -1, isIndex: true, title: "ルート" }),
      meta({ relPath: "docs/spec/README.md", outputRelPath: "docs/spec/index.html", dirIndex: 0, isIndex: true, title: "トップ" }),
    ];
    const tree = buildTree(metas, dirs);
    expect(tree[0]!.title).toBe("ルート");
    expect(tree[0]!.href).toBe("/index.html");
  });

  it("builds nested accordion structure for subdirectories", () => {
    const metas: PageMeta[] = [
      meta({ relPath: "docs/spec/sub/deep.md", outputRelPath: "docs/spec/sub/deep.html", dirIndex: 0, title: "深い" }),
    ];
    const tree = buildTree(metas, dirs);
    const section = tree[0]!;
    expect(section.children).toHaveLength(1);
    const subNode = section.children[0]!;
    expect(subNode.title).toBe("sub"); // index無しのサブディレクトリはディレクトリ名がタイトルになる
    expect(subNode.href).toBeUndefined();
    expect(subNode.children[0]!.title).toBe("深い");
  });
});
