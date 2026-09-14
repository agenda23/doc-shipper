#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { resolveOptions } from "./cli/resolve.js";
import { InteractiveCancelled } from "./cli/interactive.js";
import { build } from "./core/builder.js";
import { deployCloudflare } from "./targets/cloudflare.js";
import { deployVercel } from "./targets/vercel.js";
import { exportLocalDir } from "./targets/local-dir.js";
import { exportZip } from "./targets/zip.js";
import type { Warning } from "./types.js";

function printWarnings(warnings: Warning[]): void {
  for (const w of warnings) {
    console.warn(`⚠ [${w.file}] ${w.message}`);
  }
}

async function main(): Promise<void> {
  const { options, warnings } = await resolveOptions(process.argv);

  console.log(`doc-shipper: ${options.dirs.length}件のディレクトリを収集しています…`);
  const result = await build(options);
  console.log(
    `✔ ${result.pageCount}件のページ、${result.imageCount}件の画像、${result.fileCount}件の添付ファイルを処理しました`,
  );

  try {
    switch (options.target) {
      case "cloudflare": {
        console.log("Cloudflare Pages へデプロイしています…");
        const { url } = await deployCloudflare(result.outDir, options, warnings);
        printWarnings([...warnings, ...result.warnings]);
        if (url) console.log(`🚀 Live URL: ${url}`);
        break;
      }
      case "vercel": {
        console.log("Vercel へデプロイしています…");
        const { url } = await deployVercel(result.outDir, options, warnings);
        printWarnings([...warnings, ...result.warnings]);
        if (url) console.log(`🚀 Live URL: ${url}`);
        break;
      }
      case "dir": {
        await exportLocalDir(result.outDir, options, warnings);
        printWarnings([...warnings, ...result.warnings]);
        console.log(`✔ 出力先: ${options.out}`);
        break;
      }
      case "zip": {
        await exportZip(result.outDir, options, warnings);
        printWarnings([...warnings, ...result.warnings]);
        console.log(`✔ 出力先: ${options.out}`);
        break;
      }
    }
  } finally {
    // §6.3: 成否によらず一時ディレクトリを必ず削除する
    await rm(result.outDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  if (err instanceof InteractiveCancelled) {
    process.exit(1);
  }
  console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
