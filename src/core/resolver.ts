import { existsSync, readFileSync, lstatSync, statSync } from "node:fs";
import path from "node:path";
import type { AssetFile, RawDoc, Warning } from "../types.js";
import {
  contentHash8,
  isExternalHref,
  isImageExt,
  isIndexBasename,
  relPosix,
  splitHref,
  toOutputRelPath,
} from "../util.js";

export interface ResolveResult {
  href: string;
  changed: boolean;
}

/**
 * リンク・アセット解決を担当するクラス（§3.2・§7.1〜§7.3）。
 * 出力ディレクトリ構造はソースのリポジトリ構造をそのまま保持するため（§3.1）、
 * .md 同士の内部リンクは文字列レベルの変換（拡張子の付け替え）のみで完結する。
 * 画像・添付ファイルはハッシュベースで /assets/ 配下に集約するため、絶対パスへ完全に再構成する。
 */
export class Resolver {
  private readonly root: string;
  private readonly warnings: Warning[];

  /** ルート相対posixパス(小文字化はしない) -> 収集済みであることを示す集合 */
  private readonly docPathSet: Set<string>;
  /** ディレクトリのルート相対posixパス("" はルート) -> そのディレクトリの index 出力先 */
  private readonly dirIndexSet: Map<string, string>;

  private readonly assetsByHash = new Map<string, AssetFile>();

  constructor(root: string, docs: RawDoc[], warnings: Warning[]) {
    this.root = root;
    this.warnings = warnings;

    this.docPathSet = new Set(docs.map((d) => d.relPath));
    this.dirIndexSet = new Map();
    for (const doc of docs) {
      const basename = path.posix.basename(doc.relPath);
      if (isIndexBasename(basename) || doc.dirIndex === -1) {
        const dir = doc.dirIndex === -1 ? "" : path.posix.dirname(doc.relPath);
        const normalizedDir = dir === "." ? "" : dir;
        this.dirIndexSet.set(normalizedDir, toOutputRelPath(doc.relPath));
      }
    }
  }

  /** href の path 部分を、解決先の絶対パス（root配下と保証済み）とともに返す。範囲外なら null */
  private resolveAbs(fromAbsPath: string, pathPart: string): string | null {
    const absTarget = pathPart.startsWith("/")
      ? path.join(this.root, pathPart.slice(1))
      : path.resolve(path.dirname(fromAbsPath), decodeURIComponent(pathPart));

    const rel = relPosix(this.root, absTarget);
    if (rel === ".." || rel.startsWith("../")) {
      return null; // プロジェクトルート外（パストラバーサル）
    }
    if (this.hasSymlinkComponent(absTarget)) {
      return null; // シンボリックリンクは既定で辿らない
    }
    return absTarget;
  }

  private hasSymlinkComponent(absTarget: string): boolean {
    let current = absTarget;
    while (current !== this.root && current !== path.dirname(current)) {
      try {
        if (lstatSync(current).isSymbolicLink()) return true;
      } catch {
        // 存在しない中間パスは無視（未解決チェックは呼び出し側で行う）
      }
      current = path.dirname(current);
    }
    return false;
  }

  /**
   * marked の walkTokens 内から呼ばれるため、ここで例外を投げると marked 側の
   * onError ハンドラに横取りされ "Please report this to marked" という誤解を招くメッセージが
   * 付与されてしまう。そのため --strict でも即座には投げず、警告として記録するだけにする。
   * 実際にビルドを失敗させる判定は builder.ts が全ドキュメント処理後にまとめて行う。
   */
  private warn(fromAbsPath: string, message: string): void {
    this.warnings.push({ file: relPosix(this.root, fromAbsPath), message });
  }

  /**
   * Markdown/HTML内のリンク（.md への相対リンク、ディレクトリリンク、添付ファイルリンク）を解決する。
   * 画像は resolveAsset を使うこと。
   */
  resolveLink(fromAbsPath: string, href: string): ResolveResult {
    const { pathPart, query, hash } = splitHref(href);
    if (pathPart === "") {
      return { href, changed: false }; // フラグメントのみのリンク
    }
    if (isExternalHref(pathPart)) {
      return { href, changed: false };
    }

    const absTarget = this.resolveAbs(fromAbsPath, pathPart);
    if (absTarget === null) {
      this.warn(fromAbsPath, `リンク先がプロジェクトルート外を指しています: "${href}"`);
      return { href, changed: false };
    }

    const looksLikeDir =
      pathPart.endsWith("/") ||
      (path.posix.extname(pathPart) === "" && this.isExistingDirectory(absTarget));

    if (looksLikeDir) {
      const dirRel = relPosix(this.root, absTarget);
      const normalizedDir = dirRel === "." ? "" : dirRel;
      const outIndex = this.dirIndexSet.get(normalizedDir);
      if (outIndex === undefined) {
        this.warn(
          fromAbsPath,
          `リンク先ディレクトリに index となる README.md / index.md が見つかりません: "${href}"`,
        );
        return { href, changed: false };
      }
      const newPathPart = pathPart.endsWith("/") ? `${pathPart}index.html` : `${pathPart}/index.html`;
      return { href: `${newPathPart}${query}${hash}`, changed: true };
    }

    const basename = path.posix.basename(pathPart);
    const isMd = /\.md$/i.test(basename);

    if (!isMd) {
      // .md 以外への相対リンクは添付ファイルとしてアセットパイプラインへ
      return this.resolveAsset(fromAbsPath, href, "file");
    }

    const targetRel = relPosix(this.root, absTarget);
    if (!this.docPathSet.has(targetRel)) {
      this.warn(
        fromAbsPath,
        `リンク先が収集対象外か存在しません（選択されていないディレクトリの可能性があります）: "${href}"`,
      );
      return { href, changed: false };
    }

    const newPathPart = isIndexBasename(basename)
      ? pathPart.replace(/[^/]+$/, "index.html")
      : pathPart.replace(/\.md$/i, ".html");
    return { href: `${newPathPart}${query}${hash}`, changed: true };
  }

  /**
   * 画像・添付ファイルを解決し、ハッシュベースで /assets/ 配下に集約する（§3.2.1・§7.3）。
   */
  resolveAsset(
    fromAbsPath: string,
    href: string,
    kindHint?: "image" | "file",
  ): ResolveResult {
    const { pathPart, query, hash } = splitHref(href);
    if (pathPart === "" || isExternalHref(pathPart)) {
      return { href, changed: false };
    }

    const absTarget = this.resolveAbs(fromAbsPath, pathPart);
    if (absTarget === null) {
      this.warn(fromAbsPath, `参照先がプロジェクトルート外を指しています: "${href}"`);
      return { href, changed: false };
    }
    if (!existsSync(absTarget) || !statSync(absTarget).isFile()) {
      this.warn(fromAbsPath, `参照先ファイルが見つかりません: "${href}"`);
      return { href, changed: false };
    }

    const ext = path.extname(absTarget);
    const kind: "image" | "file" = kindHint ?? (isImageExt(ext) ? "image" : "file");
    const buf = readFileSync(absTarget);
    const digest = contentHash8(buf);

    let asset = this.assetsByHash.get(digest);
    if (!asset) {
      const base = path.basename(absTarget, ext);
      const dir = kind === "image" ? "/assets/images/" : "/assets/files/";
      asset = {
        sourceAbsPath: absTarget,
        outputHref: `${dir}${base}-${digest}${ext}`,
        kind,
      };
      this.assetsByHash.set(digest, asset);
    }

    // アセットは query を保持する意味が薄いため落とし、フラグメントのみ残す
    return { href: `${asset.outputHref}${hash && !query ? hash : ""}`, changed: true };
  }

  private isExistingDirectory(absPath: string): boolean {
    try {
      return statSync(absPath).isDirectory();
    } catch {
      return false;
    }
  }

  get assets(): AssetFile[] {
    return [...this.assetsByHash.values()];
  }
}
