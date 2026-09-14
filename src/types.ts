export type Target = "cloudflare" | "vercel" | "dir" | "zip";

export interface DirSpec {
  /** ルートからの相対パス（posix区切り、先頭・末尾スラッシュなし） */
  path: string;
  /** サイドバーのセクション見出し。未指定時は basename を用いる */
  label: string;
}

export interface AuthCredentials {
  user: string;
  pass: string;
}

export interface ResolvedOptions {
  /** プロジェクトルートの絶対パス */
  root: string;
  dirs: DirSpec[];
  includeReadme: boolean;
  target: Target;
  /** デプロイ名（slug化済み） */
  project: string;
  /** 表示用サイトタイトル（slug化前） */
  title: string;
  auth?: AuthCredentials;
  /** dir / zip ターゲット時の出力先 */
  out: string;
  strict: boolean;
  allowPublic: boolean;
  saveConfig: boolean;
  /** 読み込んだ設定ファイルのパス（無ければ undefined） */
  configPath?: string;
}

export interface RawDoc {
  /** ディスク上の絶対パス */
  absPath: string;
  /** ルートからの相対パス（posix区切り） 例: "docs/spec/auth.md" */
  relPath: string;
  /** 由来した --dir のインデックス。ルートREADMEは -1 */
  dirIndex: number;
  frontmatter: Record<string, unknown>;
  content: string;
}

export interface AssetFile {
  /** ディスク上の絶対パス（コピー元） */
  sourceAbsPath: string;
  /** 出力Webルート基準の絶対パス 例: "/assets/images/flow-a1c2e4.png" */
  outputHref: string;
  kind: "image" | "file";
}

export interface Warning {
  file: string;
  message: string;
}

export interface PageMeta {
  relPath: string;
  outputRelPath: string;
  dirIndex: number;
  title: string;
  order: number | undefined;
  isIndex: boolean;
}

export interface TreeNode {
  title: string;
  /** ルート('/')基準の href。ディレクトリのみのノードでindexが無い場合は undefined */
  href?: string;
  children: TreeNode[];
  isIndex: boolean;
}

export interface RenderedPage {
  outputRelPath: string;
  html: string;
}

export interface BuildResult {
  /** 生成物が置かれた一時ディレクトリの絶対パス */
  outDir: string;
  pageCount: number;
  imageCount: number;
  fileCount: number;
  warnings: Warning[];
}
