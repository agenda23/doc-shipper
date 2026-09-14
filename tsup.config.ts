import { cp, mkdir } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/**/*.ts", "!src/**/*.test.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // バンドルせずディレクトリ構造を保ったままトランスパイルする。
  // builder.ts は import.meta.url 基準の相対パス（"../templates/"）でテンプレートを読むため、
  // dist/ 側でも src/ と同じ相対構造（dist/core/builder.js から見て dist/templates/）を保つ必要がある。
  bundle: false,
  splitting: false,
  dts: false,
  async onSuccess() {
    await mkdir("dist/templates", { recursive: true });
    await cp("src/templates", "dist/templates", { recursive: true });
  },
});
