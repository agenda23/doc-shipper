import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedOptions, Warning } from "../types.js";
import { preflightVercel } from "../preflight.js";
import { generateVercelMiddleware } from "./worker-template.js";
import type { DeployResult } from "./cloudflare.js";

/**
 * Vercel へデプロイする（§3.4・§6.1・§6.2・§8.1・§8.2）。
 * vercel.json でフレームワーク自動検出を無効化し、静的サイトとして扱わせる。
 */
export async function deployVercel(
  buildOutDir: string,
  opts: ResolvedOptions,
  warnings: Warning[],
): Promise<DeployResult> {
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const { runner } = await preflightVercel(isTTY);

  await writeFile(
    path.join(buildOutDir, "vercel.json"),
    `${JSON.stringify({ framework: null, buildCommand: null, outputDirectory: "." }, null, 2)}\n`,
    "utf8",
  );

  if (opts.auth) {
    await writeFile(path.join(buildOutDir, "middleware.ts"), generateVercelMiddleware("env"), "utf8");
    await runner(["env", "add", "BASIC_AUTH_USER", "production"], { input: opts.auth.user });
    await runner(["env", "add", "BASIC_AUTH_PASS", "production"], { input: opts.auth.pass });
  } else {
    warnings.push({
      file: opts.project,
      message: "Basic認証情報が未指定のため（--allow-public）、認証保護なしで公開します。",
    });
  }

  const { stdout } = await runner(["deploy", "--prod", "--yes", buildOutDir]);
  const match = /(https:\/\/\S+\.vercel\.app)/.exec(stdout);
  return { url: match?.[0] };
}
