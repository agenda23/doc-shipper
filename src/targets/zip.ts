import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import type { ResolvedOptions, Warning } from "../types.js";
import { generateCloudflareWorker } from "./worker-template.js";

/**
 * `dir` の出力一式を `--out` に ZIP アーカイブする（§3.4・§6.3）。
 * 認証埋め込みの扱いは local-dir と同じ（§7.5）。
 */
export async function exportZip(buildOutDir: string, opts: ResolvedOptions, warnings: Warning[]): Promise<void> {
  if (opts.auth) {
    await writeFile(path.join(buildOutDir, "_worker.js"), generateCloudflareWorker(opts.auth), "utf8");
    warnings.push({
      file: opts.out,
      message:
        "zip ターゲットでは Basic 認証情報が _worker.js に平文で埋め込まれています。Cloudflare Pages 等へ手動デプロイする際は Secrets への移行を検討してください（§7.5）。",
    });
  }

  await mkdir(path.dirname(opts.out), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(opts.out);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(buildOutDir, false);
    void archive.finalize();
  });
}
