import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedOptions, Warning } from "../types.js";
import { ensureCloudflareProject, preflightCloudflare } from "../preflight.js";
import { generateCloudflareWorker } from "./worker-template.js";

export interface DeployResult {
  url?: string;
}

/**
 * Cloudflare Pages へデプロイする（§3.4・§6.1・§6.2・§8.1）。
 * Basic認証情報は `wrangler pages secret put` に stdin 経由で渡し、
 * コマンドライン引数やログに値を残さない。
 */
export async function deployCloudflare(
  buildOutDir: string,
  opts: ResolvedOptions,
  warnings: Warning[],
): Promise<DeployResult> {
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const { runner } = await preflightCloudflare(isTTY);
  await ensureCloudflareProject(runner, opts.project);

  if (opts.auth) {
    await writeFile(path.join(buildOutDir, "_worker.js"), generateCloudflareWorker("env"), "utf8");
    // 値は stdin 経由で渡す（コマンドライン引数だと ps 等のプロセス一覧に露出するため。§8.1）
    await runner(["pages", "secret", "put", "BASIC_AUTH_USER", "--project-name", opts.project], {
      input: opts.auth.user,
    });
    await runner(["pages", "secret", "put", "BASIC_AUTH_PASS", "--project-name", opts.project], {
      input: opts.auth.pass,
    });
  } else {
    warnings.push({
      file: opts.project,
      message: "Basic認証情報が未指定のため（--allow-public）、認証保護なしで公開します。",
    });
  }

  const { stdout } = await runner(["pages", "deploy", buildOutDir, "--project-name", opts.project]);
  const match = /(https:\/\/\S+\.pages\.dev)/.exec(stdout);
  return { url: match?.[0] };
}
