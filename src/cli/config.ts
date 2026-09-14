import { readFile, writeFile } from "node:fs/promises";
import type { Target, Warning } from "../types.js";

export interface ConfigDirEntry {
  path: string;
  label?: string;
}

export interface DocShipperConfig {
  dirs?: ConfigDirEntry[];
  includeReadme?: boolean;
  target?: Target;
  project?: string;
  title?: string;
  out?: string;
  strict?: boolean;
}

/** §4.3: 設定ファイルに書いてはいけない（秘密情報に相当する）キー */
const FORBIDDEN_KEYS = [
  "auth",
  "password",
  "pass",
  "user",
  "username",
  "token",
  "apitoken",
  "apikey",
  "secret",
  "secrets",
  "credentials",
];

const ALLOWED_KEYS = new Set([
  "$schema",
  "dirs",
  "includeReadme",
  "target",
  "project",
  "title",
  "out",
  "strict",
]);

/**
 * .doc-shipper.json を読み込む。存在しなければ undefined を返す。
 * 秘密情報に相当するキーが含まれていた場合は値を無視し警告する（§4.3）。
 */
export async function loadConfig(
  configPath: string,
  warnings: Warning[],
): Promise<DocShipperConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`設定ファイル ${configPath} の JSON パースに失敗しました: ${(err as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`設定ファイル ${configPath} はオブジェクトである必要があります`);
  }

  const obj = parsed as Record<string, unknown>;
  const config: DocShipperConfig = {};

  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase())) {
      warnings.push({
        file: configPath,
        message: `設定ファイルに秘密情報に相当するキー "${key}" が含まれていたため無視しました。Basic認証情報は --auth / 環境変数 / 対話プロンプトから指定してください。`,
      });
      continue;
    }
    if (!ALLOWED_KEYS.has(key)) {
      warnings.push({ file: configPath, message: `設定ファイルの未知のキー "${key}" は無視されました。` });
      continue;
    }
  }

  if (Array.isArray(obj.dirs)) {
    config.dirs = obj.dirs
      .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
      .map((d) => ({
        path: String(d.path ?? ""),
        label: typeof d.label === "string" ? d.label : undefined,
      }))
      .filter((d) => d.path !== "");
  }
  if (typeof obj.includeReadme === "boolean") config.includeReadme = obj.includeReadme;
  if (typeof obj.target === "string") config.target = obj.target as Target;
  if (typeof obj.project === "string") config.project = obj.project;
  if (typeof obj.title === "string") config.title = obj.title;
  if (typeof obj.out === "string") config.out = obj.out;
  if (typeof obj.strict === "boolean") config.strict = obj.strict;

  return config;
}

/** 秘密情報を含まない設定を .doc-shipper.json として書き出す（§4.3・--save-config） */
export async function writeConfig(configPath: string, config: DocShipperConfig): Promise<void> {
  const payload = {
    $schema: "https://doc-shipper.dev/schema/v1.json",
    ...config,
  };
  await writeFile(configPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
