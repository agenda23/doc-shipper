import path from "node:path";
import * as clack from "@clack/prompts";
import fg from "fast-glob";
import type { AuthCredentials, Target } from "../types.js";

export interface InteractiveDirAnswer {
  path: string;
  label?: string;
}

export interface InteractiveAnswers {
  dirs?: InteractiveDirAnswer[];
  includeReadme?: boolean;
  target?: Target;
  auth?: AuthCredentials;
  project?: string;
  saveConfig?: boolean;
}

export interface InteractiveNeeds {
  dirs: boolean;
  includeReadme: boolean;
  target: boolean;
  /** target がデプロイ系で --allow-public も未指定の場合のみ true にする */
  auth: boolean;
  project: boolean;
  /** --no-config でない場合のみ保存確認を出す */
  offerSaveConfig: boolean;
}

class InteractiveCancelled extends Error {
  constructor() {
    super("対話プロンプトがキャンセルされました");
  }
}

function checkCancel<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel("キャンセルされました。");
    throw new InteractiveCancelled();
  }
  return value;
}

/** ドキュメントを直接含むディレクトリを候補として提示する（表示専用の簡易探索） */
async function discoverCandidateDirs(root: string): Promise<string[]> {
  const files = await fg("**/*.md", {
    cwd: root,
    ignore: ["**/node_modules/**", "**/.git/**", "**/.*/**", "dist/**"],
    onlyFiles: true,
  });
  const dirs = new Set<string>();
  for (const f of files) {
    const dir = path.posix.dirname(f);
    if (dir !== "." && dir !== "README.md") dirs.add(dir);
  }
  return [...dirs].sort();
}

export async function runInteractive(needs: InteractiveNeeds, root: string): Promise<InteractiveAnswers> {
  const answers: InteractiveAnswers = {};

  clack.intro("doc-shipper");

  if (needs.dirs) {
    const candidates = await discoverCandidateDirs(root);
    if (candidates.length === 0) {
      clack.log.warn("Markdownドキュメントを含むディレクトリが見つかりませんでした。--dir で明示的に指定してください。");
      answers.dirs = [];
    } else {
      const selected = checkCancel(
        await clack.multiselect({
          message: "対象ドキュメントディレクトリを選択してください:",
          options: candidates.map((c) => ({ value: c, label: c })),
          required: false,
        }),
      );

      const dirs: InteractiveDirAnswer[] = [];
      for (const dirPath of selected) {
        const label = checkCancel(
          await clack.text({
            message: `"${dirPath}" のラベル（サイドバー見出し。空欄でディレクトリ名を使用）:`,
            placeholder: path.basename(dirPath),
          }),
        );
        dirs.push({ path: dirPath, label: label === "" ? undefined : label });
      }
      answers.dirs = dirs;
    }
  }

  if (needs.includeReadme) {
    answers.includeReadme = checkCancel(
      await clack.confirm({
        message: "ルートの README.md をトップページとして含めますか？",
        initialValue: true,
      }),
    );
  }

  if (needs.target) {
    answers.target = checkCancel(
      await clack.select<Target>({
        message: "出力先を選択してください:",
        options: [
          { value: "cloudflare", label: "Cloudflare Pages" },
          { value: "vercel", label: "Vercel" },
          { value: "dir", label: "Export to Directory" },
          { value: "zip", label: "Export as ZIP" },
        ],
      }),
    );
  }

  if (needs.auth) {
    const user = checkCancel(
      await clack.text({ message: "Basic認証のユーザー名（空欄で認証なし）:" }),
    );
    if (user !== "") {
      const pass = checkCancel(
        await clack.password({ message: "Basic認証のパスワード:" }),
      );
      answers.auth = { user, pass };
    }
  }

  if (needs.project) {
    answers.project = checkCancel(
      await clack.text({
        message: "プロジェクト / サイト名:",
        placeholder: path.basename(root),
      }),
    );
  }

  if (needs.offerSaveConfig) {
    answers.saveConfig = checkCancel(
      await clack.confirm({
        message: "この設定を .doc-shipper.json に保存しますか？（認証情報は保存されません）",
        initialValue: false,
      }),
    );
  }

  return answers;
}

export { InteractiveCancelled };
