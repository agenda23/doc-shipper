import { Command, InvalidArgumentError } from "commander";
import type { AuthCredentials, Target } from "../types.js";

export interface CliDirEntry {
  path: string;
  label?: string;
}

export interface CliInput {
  dirs: CliDirEntry[];
  root?: string;
  target?: Target;
  project?: string;
  title?: string;
  strict?: boolean;
  auth?: AuthCredentials;
  out?: string;
  /** --config <path> なら文字列、--no-config なら false、未指定なら undefined */
  config?: string | false;
  saveConfig?: boolean;
  includeReadme?: boolean;
  allowPublic?: boolean;
}

/**
 * --dir <path[:label]> をパースする（§4.1・§7.6）。
 * ラベルは最後の ":" で分割するが、その後ろにパス区切り(/ or \)を含む場合は
 * Windows のドライブレター（C:\docs）等とみなしラベル無しとして扱う。
 */
export function parseDirArg(raw: string): CliDirEntry {
  const lastColon = raw.lastIndexOf(":");
  if (lastColon === -1) return { path: raw };
  const after = raw.slice(lastColon + 1);
  if (after.includes("/") || after.includes("\\")) {
    return { path: raw };
  }
  const label = after.trim();
  return { path: raw.slice(0, lastColon), label: label === "" ? undefined : label };
}

/** --auth <user:pass> を最初の ":" で分割する（パスワード側の ":" を許容, §4.1） */
export function parseAuthArg(raw: string): AuthCredentials {
  const idx = raw.indexOf(":");
  if (idx === -1) {
    throw new InvalidArgumentError('--auth は "user:pass" 形式で指定してください');
  }
  return { user: raw.slice(0, idx), pass: raw.slice(idx + 1) };
}

const TARGETS: Target[] = ["cloudflare", "vercel", "dir", "zip"];

function parseTargetArg(raw: string): Target {
  if (!(TARGETS as string[]).includes(raw)) {
    throw new InvalidArgumentError(`--target は ${TARGETS.join(", ")} のいずれかで指定してください`);
  }
  return raw as Target;
}

export function parseArgs(argv: string[]): CliInput {
  const program = new Command();
  program
    .name("doc-shipper")
    .description("GitHubプライベートリポジトリ内のMarkdownドキュメントをBasic認証付き静的サイトとして共有するCLI")
    .option("-d, --dir <path[:label]>", "対象ドキュメントディレクトリ（複数指定可）", (v, prev: CliDirEntry[]) => {
      prev.push(parseDirArg(v));
      return prev;
    }, [] as CliDirEntry[])
    .option("--root <path>", "出力パスの基準となるプロジェクトルート")
    .option("-t, --target <provider>", "出力先 (cloudflare, vercel, dir, zip)", parseTargetArg)
    .option("-p, --project <name>", "デプロイ先プロジェクト名")
    .option("--title <name>", "サイドバー等に表示するサイトタイトル")
    .option("--strict", "参照先未解決・パストラバーサル・対象外リンクを警告でなくエラーにする")
    .option("-a, --auth <user:pass>", "Basic認証のユーザーとパスワード", parseAuthArg)
    .option("-o, --out <path>", "出力先パス (dir, zip ターゲット時)")
    .option("--config <path>", "読み込む設定ファイルのパス")
    .option("--no-config", "設定ファイルが存在しても無視する")
    .option("--save-config", "実行後、非秘密設定を .doc-shipper.json に保存する")
    .option("--include-readme", "ルートの README.md をトップに含める")
    .option("--no-include-readme", "ルートの README.md をトップに含めない")
    .option("--allow-public", "--auth 未指定のままデプロイ系ターゲットを実行することを許可");

  program.parse(argv);
  const opts = program.opts<{
    dir: CliDirEntry[];
    root?: string;
    target?: Target;
    project?: string;
    title?: string;
    strict?: boolean;
    auth?: AuthCredentials;
    out?: string;
    config?: string | boolean;
    saveConfig?: boolean;
    includeReadme?: boolean;
    allowPublic?: boolean;
  }>();

  return {
    dirs: opts.dir,
    root: opts.root,
    target: opts.target,
    project: opts.project,
    title: opts.title,
    strict: opts.strict,
    auth: opts.auth,
    out: opts.out,
    config: opts.config === false ? false : (opts.config as string | undefined),
    saveConfig: opts.saveConfig,
    includeReadme: opts.includeReadme,
    allowPublic: opts.allowPublic,
  };
}
