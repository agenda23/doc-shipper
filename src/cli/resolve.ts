import path from "node:path";
import { execa } from "execa";
import type { AuthCredentials, DirSpec, ResolvedOptions, Target, Warning } from "../types.js";
import { relPosix, slugify, toPosix } from "../util.js";
import { parseArgs, parseAuthArg, type CliDirEntry, type CliInput } from "./args.js";
import { loadConfig, writeConfig, type DocShipperConfig } from "./config.js";
import { runInteractive, type InteractiveDirAnswer } from "./interactive.js";

const DEPLOY_TARGETS: Target[] = ["cloudflare", "vercel"];

function isDeployTarget(t: Target): boolean {
  return DEPLOY_TARGETS.includes(t);
}

/** --dir がプロジェクトルート配下であることを検証し、正規化した相対posixパスを返す（§3.1・§7.1） */
function validateAndNormalizeDirPath(root: string, rawPath: string): string {
  if (path.isAbsolute(rawPath)) {
    throw new Error(`--dir には絶対パスを指定できません: "${rawPath}"`);
  }
  const abs = path.resolve(root, rawPath);
  const rel = relPosix(root, abs);
  if (rel === ".." || rel.startsWith("../")) {
    throw new Error(`--dir はプロジェクトルート配下を指定してください（"../" によるルート外脱出は不可）: "${rawPath}"`);
  }
  return rel === "" ? "." : rel;
}

function toDirSpecs(root: string, entries: (CliDirEntry | InteractiveDirAnswer)[]): DirSpec[] {
  return entries.map((e) => {
    const normalized = validateAndNormalizeDirPath(root, e.path);
    return { path: normalized, label: e.label ?? path.basename(normalized) };
  });
}

function parseEnvAuth(): AuthCredentials | undefined {
  const combined = process.env.DOC_SHIPPER_AUTH;
  if (combined) return parseAuthArg(combined);
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (user && pass) return { user, pass };
  return undefined;
}

async function deriveDefaultProjectName(root: string): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const pkgRaw = await readFile(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { name?: string };
    if (pkg.name && pkg.name.trim() !== "") return pkg.name;
  } catch {
    // package.json が無い/読めない/nameが無い場合は次の手段へ
  }

  try {
    const { stdout } = await execa("git", ["config", "--get", "remote.origin.url"], { cwd: root });
    const url = stdout.trim();
    const match = /\/([^/]+?)(\.git)?$/.exec(url);
    if (match?.[1]) return match[1];
  } catch {
    // git が無い/リモート未設定の場合は次の手段へ
  }

  return path.basename(root);
}

export interface ResolveContext {
  options: ResolvedOptions;
  warnings: Warning[];
}

/**
 * CLI引数 / 設定ファイル / 対話プロンプト / 既定値を優先順位に従ってマージする（§4.3・§7.6）。
 * 認証情報のみ別系統（--auth > 環境変数 > 対話）で、設定ファイルからは読まない。
 */
export async function resolveOptions(argv: string[]): Promise<ResolveContext> {
  const warnings: Warning[] = [];
  const cli = parseArgs(argv);

  const root = path.resolve(cli.root ?? process.cwd());

  let config: DocShipperConfig | undefined;
  let configPathUsed: string | undefined;
  if (cli.config !== false) {
    const configPath = typeof cli.config === "string" ? path.resolve(cli.config) : path.join(root, ".doc-shipper.json");
    config = await loadConfig(configPath, warnings);
    if (config) configPathUsed = configPath;
  }

  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  // --- target（対話要否の判定に auth より先に必要） ---
  const targetPre: Target | undefined = cli.target ?? config?.target;
  const effectiveTargetForAuthCheck: Target = targetPre ?? "cloudflare";

  // --- 必須項目の充足チェック（§7.6） ---
  const cliOrConfigDirs: CliDirEntry[] | undefined = cli.dirs.length > 0 ? cli.dirs : config?.dirs;
  const dirsMissing = !cliOrConfigDirs || cliOrConfigDirs.length === 0;

  const authPre = cli.auth ?? parseEnvAuth();
  const authMissing =
    isDeployTarget(effectiveTargetForAuthCheck) && authPre === undefined && !cli.allowPublic;

  const anyRequiredMissing = dirsMissing || authMissing;

  if (anyRequiredMissing && !isTTY) {
    const missing: string[] = [];
    if (dirsMissing) missing.push("--dir");
    if (authMissing) missing.push("--auth（または --allow-public）");
    throw new Error(
      `非対話環境（TTY無し）で必須オプションが不足しています: ${missing.join(", ")}。CI等では対話プロンプトにフォールバックしません。`,
    );
  }

  const willPrompt = anyRequiredMissing && isTTY;

  const interactive = willPrompt
    ? await runInteractive(
        {
          dirs: dirsMissing,
          auth: authMissing,
          includeReadme: willPrompt && cli.includeReadme === undefined && config?.includeReadme === undefined,
          target: willPrompt && targetPre === undefined,
          project: willPrompt && cli.project === undefined && config?.project === undefined,
          offerSaveConfig: willPrompt && cli.config !== false,
        },
        root,
      )
    : {};

  // --- dirs 確定 ---
  const rawDirs = cliOrConfigDirs && cliOrConfigDirs.length > 0 ? cliOrConfigDirs : interactive.dirs ?? [];
  if (rawDirs.length === 0) {
    throw new Error("対象ドキュメントディレクトリが指定されていません（--dir）。");
  }
  const dirs = toDirSpecs(root, rawDirs);

  // --- includeReadme ---
  const includeReadme = cli.includeReadme ?? config?.includeReadme ?? interactive.includeReadme ?? true;

  // --- target 確定 ---
  const target = targetPre ?? interactive.target ?? "cloudflare";

  // --- auth 確定（設定ファイルからは読まない） ---
  const auth = authPre ?? interactive.auth;
  if (isDeployTarget(target) && !auth && !cli.allowPublic) {
    throw new Error(
      "Basic認証情報が指定されていません。--auth / 環境変数 DOC_SHIPPER_AUTH / --allow-public のいずれかを指定してください。",
    );
  }

  // --- project / title（§7.6） ---
  const explicitProjectRaw = cli.project ?? config?.project ?? interactive.project;
  const projectRawSource = explicitProjectRaw ?? (await deriveDefaultProjectName(root));
  const project = slugify(projectRawSource);
  const title = cli.title ?? projectRawSource;

  // --- out / strict / allowPublic / saveConfig ---
  const out = path.resolve(cli.out ?? config?.out ?? "./dist");
  const strict = cli.strict ?? config?.strict ?? false;
  const allowPublic = cli.allowPublic ?? false;
  const saveConfig = cli.saveConfig ?? interactive.saveConfig ?? false;

  const options: ResolvedOptions = {
    root,
    dirs,
    includeReadme,
    target,
    project,
    title,
    auth,
    out,
    strict,
    allowPublic,
    saveConfig,
    configPath: configPathUsed,
  };

  if (saveConfig && cli.config !== false) {
    const savePath = typeof cli.config === "string" ? path.resolve(cli.config) : path.join(root, ".doc-shipper.json");
    await writeConfig(savePath, {
      dirs: dirs.map((d) => ({ path: toPosix(d.path), label: d.label })),
      includeReadme,
      target,
      project,
      title,
      out: path.relative(root, out) || ".",
      strict,
    });
  }

  return { options, warnings };
}
