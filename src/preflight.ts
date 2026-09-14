import { execa } from "execa";
import * as clack from "@clack/prompts";
import { InteractiveCancelled } from "./cli/interactive.js";

export interface RunnerResult {
  stdout: string;
  stderr: string;
}

export type CliRunner = (
  args: string[],
  opts?: { input?: string; env?: Record<string, string | undefined> },
) => Promise<RunnerResult>;

async function resolveRunner(bin: string, latestPkg: string): Promise<{ runner: CliRunner; usedFallback: boolean }> {
  try {
    await execa(bin, ["--version"]);
    const runner: CliRunner = async (args, opts) => execa(bin, args, opts);
    return { runner, usedFallback: false };
  } catch {
    // 未導入時は npx <pkg>@latest へフォールバック（§6.2・§7.7）
    const runner: CliRunner = async (args, opts) => execa("npx", [latestPkg, ...args], opts);
    return { runner, usedFallback: true };
  }
}

export interface PreflightResult {
  runner: CliRunner;
  usedFallback: boolean;
}

interface CloudflareAccount {
  name: string;
  id: string;
}

/**
 * wrangler の「複数アカウントがあり非対話モードでは選択できません」エラーからアカウント一覧を抽出する。
 * エラーメッセージ例:
 *   Available accounts are (`<name>`: `<account_id>`):
 *     `foo@example.com's Account`: `59367e98606e7cc0734c621d4dcf73b5`
 */
export function parseMultiAccountError(text: string): CloudflareAccount[] | null {
  if (!/More than one account available/.test(text)) return null;
  const accounts: CloudflareAccount[] = [];
  const re = /`([^`]+)`:\s*`([0-9a-f]{32})`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    accounts.push({ name: m[1]!, id: m[2]! });
  }
  return accounts.length > 0 ? accounts : null;
}

async function selectCloudflareAccount(accounts: CloudflareAccount[]): Promise<string> {
  const chosen = await clack.select({
    message: "複数の Cloudflare アカウントが見つかりました。デプロイ先アカウントを選択してください:",
    options: accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.id})` })),
  });
  if (clack.isCancel(chosen)) {
    clack.cancel("キャンセルされました。");
    throw new InteractiveCancelled();
  }
  return chosen;
}

/**
 * Cloudflare (`wrangler`) のデプロイ前チェック（§6.2）。
 * v3以上（`pages deploy`）を要求し、v2 (`pages publish`) は非対応としてエラーにする。
 *
 * 複数アカウントを保有するユーザーの場合、`wrangler` はサブプロセス実行（非対話モード扱い）では
 * アカウントを自動選択できずエラーになる。対話環境ではここでユーザーに選択させ、
 * 以降のすべての wrangler 呼び出しに `CLOUDFLARE_ACCOUNT_ID` を自動付与する。
 */
export async function preflightCloudflare(isTTY: boolean): Promise<PreflightResult> {
  const { runner: baseRunner, usedFallback } = await resolveRunner("wrangler", "wrangler@latest");

  if (!usedFallback) {
    const { stdout } = await execa("wrangler", ["--version"]);
    const match = /(\d+)\.\d+\.\d+/.exec(stdout);
    const major = match ? Number(match[1]) : 0;
    if (major < 3) {
      throw new Error(
        `wrangler のバージョンが古すぎます（検出: ${stdout.trim()}）。v3以上（pages deploy サブコマンド）が必要です。`,
      );
    }
  }

  if (isTTY) {
    try {
      await baseRunner(["whoami"]);
    } catch {
      throw new Error(
        "Cloudflare にログインしていません。`wrangler login` を実行してから再度お試しください。",
      );
    }
  } else if (!process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error("非対話環境では環境変数 CLOUDFLARE_API_TOKEN が必要です（§6.2）。");
  }

  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    try {
      await baseRunner(["pages", "project", "list"]);
    } catch (err) {
      const text = `${(err as { stderr?: string }).stderr ?? ""}\n${(err as Error).message ?? ""}`;
      const accounts = parseMultiAccountError(text);
      if (accounts) {
        if (!isTTY) {
          throw new Error(
            `複数の Cloudflare アカウントが見つかりました。非対話環境では環境変数 CLOUDFLARE_ACCOUNT_ID を指定してください。候補: ${accounts
              .map((a) => `${a.name}=${a.id}`)
              .join(", ")}`,
          );
        }
        accountId = await selectCloudflareAccount(accounts);
      }
      // それ以外のエラー（プロジェクト一覧取得自体の失敗等）はここでは無視し、
      // 実際の後続処理（ensureCloudflareProject 等）で改めて表面化させる。
    }
  }

  const runner: CliRunner = accountId
    ? async (args, opts) =>
        baseRunner(args, { ...opts, env: { ...opts?.env, CLOUDFLARE_ACCOUNT_ID: accountId } })
    : baseRunner;

  return { runner, usedFallback };
}

/** Cloudflare Pages のプロジェクトが無ければ作成する（§6.2） */
export async function ensureCloudflareProject(runner: CliRunner, projectName: string): Promise<void> {
  const { stdout } = await runner(["pages", "project", "list"]);
  if (stdout.includes(projectName)) return;
  await runner(["pages", "project", "create", projectName, "--production-branch", "main"]);
}

/** Vercel のデプロイ前チェック（§6.2） */
export async function preflightVercel(isTTY: boolean): Promise<PreflightResult> {
  const { runner, usedFallback } = await resolveRunner("vercel", "vercel@latest");

  if (isTTY) {
    try {
      await runner(["whoami"]);
    } catch {
      throw new Error("Vercel にログインしていません。`vercel login` を実行してから再度お試しください。");
    }
  } else if (!process.env.VERCEL_TOKEN) {
    throw new Error("非対話環境では環境変数 VERCEL_TOKEN が必要です（§6.2）。");
  }

  return { runner, usedFallback };
}
