import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedOptions, Warning } from "../types.js";
import { generateCloudflareWorker } from "./worker-template.js";

/**
 * `--out` へ静的ファイル一式を出力する（§3.4・§6.3）。
 * --auth 指定時は _worker.js を認証情報を直接埋め込んだ状態で同梱する
 * （デプロイ実行を伴わないため Secrets を設定できない。§7.5で平文残存を警告する）。
 */
export async function exportLocalDir(
  buildOutDir: string,
  opts: ResolvedOptions,
  warnings: Warning[],
): Promise<void> {
  if (opts.auth) {
    await writeFile(path.join(buildOutDir, "_worker.js"), generateCloudflareWorker(opts.auth), "utf8");
    warnings.push({
      file: opts.out,
      message:
        "dir ターゲットでは Basic 認証情報が _worker.js に平文で埋め込まれています。Cloudflare Pages 等へ手動デプロイする際は Secrets への移行を検討してください（§7.5）。",
    });
  }

  await mkdir(path.dirname(opts.out), { recursive: true });
  await cp(buildOutDir, opts.out, { recursive: true });
}
