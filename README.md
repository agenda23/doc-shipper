# doc-shipper

GitHub のプライベートリポジトリ内にある Markdown ドキュメント（仕様書・設計書など）を、
GitHub アカウントを持たない社外関係者へ **Basic 認証付きの静的サイト**として安全に共有するための Node.js 製 CLI ツールです。

- リポジトリを汚さない（設定ファイルの追加を **要求しない**）
- 散らばった複数のドキュメントディレクトリを 1 つの GitHub ライクなサイトへ統合
- 画像・相対リンクを自動解決し、Cloudflare Pages / Vercel へワンコマンドでデプロイ

> [!NOTE]
> **実装中です。** コア機能（Markdown収集・リンク/アセット解決・HTML生成）、`dir`/`zip`出力、
> および `cloudflare` ターゲットへの実デプロイは動作確認済みです。**`vercel` への実デプロイは未検証**です。
> 詳細な仕様は [`documents/spec.md`](documents/spec.md)、実装の進捗・既知の課題は
> [`documents/progress.md`](documents/progress.md) を参照してください。

## 特徴

| | |
|---|---|
| **Zero Config in Repo** | 対象リポジトリ側に設定ファイルを一切要求しない。CLI 引数と対話プロンプトのみで完結。繰り返し利用向けに、**秘密情報を含まない** `.doc-shipper.json` を任意で保存可能 |
| **マルチディレクトリ統合** | `docs/spec`, `architecture`, `packages/core/docs` … を 1 つの仮想ドキュメントサイトへ再構成 |
| **リポジトリ構造を保持** | 出力 URL はリポジトリ構造をそのまま反映（`docs/spec/auth.md` → `/docs/spec/auth.html`）。パスの再マッピングをしないためリンク切れが起きにくい |
| **アセット自動解決** | 相対参照された画像・添付ファイルを実体探索し、内容ハッシュで衝突防止・重複排除して集約。`src` / リンクを自動書き換え |
| **ルート README 連携** | リポジトリ直下の `README.md` をトップページ（`/`）に設定（デフォルト有効） |
| **マルチターゲット出力** | Cloudflare Pages / Vercel / ローカルディレクトリ / ZIP |
| **Basic 認証の自動統合** | エッジ Worker / Middleware を生成し、静的アセットも含めて全リクエストを保護 |
| **デュアルインターフェース** | 引数なしの対話型 CUI と、CI/CD 向けのコマンドラインオプションを両立 |

## 動作要件

- Node.js v20 LTS 以上（v18 は EOL のため対象外）
- デプロイ系ターゲットを使う場合: `wrangler`（v3 以上）または `vercel` CLI（未導入時は `npx <pkg>@latest` へ自動フォールバック）

## 使い方

> [!NOTE]
> 以下は npm 公開後の想定インターフェースです。**現時点ではまだ npm に公開していないため `npx doc-shipper` は動作しません。**
> ローカルで試す場合は [開発中の使用方法](#開発中の使用方法) を参照してください。

インストール不要で実行できます。

```bash
# Cloudflare Pages へ直接デプロイ
npx doc-shipper \
  --dir "docs/spec:仕様書" \
  --dir "architecture:アーキテクチャ" \
  --target cloudflare \
  --project my-secure-spec \
  --auth "client:secretpass"

# 配布用 ZIP を出力
npx doc-shipper \
  --dir "docs/spec:仕様書" \
  --target zip \
  --out ./exported-docs.zip
```

### 対話モード

オプションを省略して実行すると、対話型プロンプトが起動します（一部だけ指定した場合は不足分のみ質問）。
TTY が無い環境（CI 等）では対話にフォールバックせず、必須項目の欠如をエラーにします。

```
┌  doc-shipper
│
◇  Select documentation directories to include:
│  [x] docs/spec        [x] architecture      [ ] src/
│
◇  Enter labels for the directories: …
◇  Include root README.md as the homepage?  ● Yes
◇  Select output target:  ● Cloudflare Pages
◇  Set Basic Auth (leave empty for none):  Username / Password
◇  Project / Site Name:  my-private-docs
◇  Save these settings to .doc-shipper.json for next time? (auth is never saved)
│
└  🚀 Live URL: https://my-private-docs.pages.dev
```

## CLI オプション

| オプション | 既定値 | 説明 |
|---|---|---|
| `-d, --dir <path[:label]>` | (なし) | 対象ドキュメントディレクトリ（複数指定可。`:` の後にラベル）。プロジェクトルート配下に限る |
| `--root <path>` | カレントディレクトリ | 出力パスの基準となるプロジェクトルート |
| `-t, --target <provider>` | `cloudflare` | `cloudflare` / `vercel` / `dir` / `zip` |
| `-p, --project <name>` | `package.json` の name → git remote → ルート名 | デプロイ先プロジェクト名（DNS セーフに slug 化） |
| `--title <name>` | `--project` の値 | サイドバー等に表示するサイトタイトル |
| `-a, --auth <user:pass>` | (なし) | Basic 認証のユーザーとパスワード。環境変数 `DOC_SHIPPER_AUTH` でも可。**設定ファイルには保存されない** |
| `-o, --out <path>` | `./dist` | 出力先（`dir` / `zip` 時） |
| `--include-readme` / `--no-include-readme` | `true` | ルート `README.md` をトップに含めるか |
| `--allow-public` | `false` | `--auth` 未指定のままデプロイすることを許可（無認証公開の事故防止） |
| `--strict` | `false` | 参照先未解決・パストラバーサル・対象外リンクを警告でなくエラーにする |
| `--config <path>` | `<root>/.doc-shipper.json` | 読み込む設定ファイル |
| `--no-config` | - | 設定ファイルが存在しても無視する |
| `--save-config` | `false` | 実行後、非秘密設定を `.doc-shipper.json` に保存 |
| `-h, --help` | - | ヘルプ |

## 出力ターゲット

| `--target` | 認証 | 動作 |
|---|---|---|
| `cloudflare` | `_worker.js`（Basic 認証） | エッジ Worker を生成し `wrangler pages deploy` を実行 |
| `vercel` | Edge Middleware | `middleware.ts` を生成し `vercel deploy --prod` を実行（静的アセットを含む全パスを保護） |
| `dir` | ホスティング先に依存 | `--out` に静的 HTML・アセット・認証ハンドラを出力。認証はデプロイ先で有効化 |
| `zip` | ホスティング先に依存 | `dir` の出力一式を `--out` に ZIP アーカイブ |

デプロイ系ターゲットではビルド成果物を OS の一時ディレクトリに生成し、完了後に自動削除します。
リポジトリ内には生成物・キャッシュを一切残しません。

## 設定ファイル `.doc-shipper.json`（任意）

ドキュメント更新のたびの再実行を楽にするための、**秘密情報を含まない**設定ファイルです。
`--root` 直下に置くと自動的に読み込まれます（無くても全機能が動作します）。

```json
{
  "$schema": "https://doc-shipper.dev/schema/v1.json",
  "dirs": [
    { "path": "docs/spec", "label": "仕様書" },
    { "path": "architecture", "label": "アーキテクチャ" }
  ],
  "includeReadme": true,
  "target": "cloudflare",
  "project": "my-secure-spec",
  "title": "社内仕様書",
  "strict": false
}
```

- **保存できる**: `dirs` / `includeReadme` / `target` / `project` / `title` / `out` / `strict`
- **保存できない**: Basic 認証情報、API トークン等の秘密情報
  （`auth` 等のキーが書かれていても値は無視し、警告を表示します）
- 設定値の優先順位: `CLI 引数` > `.doc-shipper.json` > `対話補完` > `既定値`
- 認証情報は常に `--auth` / 環境変数 / 対話プロンプトから取得します
- 秘密情報を含まないため、チーム / CI で共有する目的でコミットして構いません

## 認証情報の取り扱い

- `cloudflare` / `vercel` へデプロイする際、Basic 認証のユーザー / パスワードは
  デプロイ先の環境変数（Cloudflare: Secret、Vercel: Environment Variable）として設定され、
  ビルド成果物・Git 履歴・CI ログには残りません。
- `dir` / `zip` 出力では認証ハンドラ内に平文で残るため、実行時に警告を表示します。

## 出力構造

```
dist/
├── index.html                  # ルート README（または先頭ページへの誘導）
├── docs/spec/auth.html
├── architecture/system.html
├── assets/
│   ├── styles.css
│   ├── sidebar.js
│   ├── images/                 # 内容ハッシュで集約・重複排除
│   └── files/                  # .md 以外の添付ファイル
└── _worker.js                  # Cloudflare ターゲット時のみ
```

## 仕組み

`collector`（`.md` 収集・フロントマター抽出）→ `resolver`（元パス→出力パスの対応表構築・アセット集約）
→ `parser`（`marked` + `shiki` でレンダリング、対応表を適用してリンク書き換え）
→ `tree`（サイドバー生成）→ `builder`（静的 HTML 出力）→ `targets/*`（ターゲット別デプロイ）。

## 開発中の使用方法

npm には未公開のため、リポジトリを clone してローカルでビルドしたものを直接実行します。

### セットアップ

```bash
git clone <このリポジトリのURL>
cd doc-shipper
npm install
npm run build   # tsup で src/ を dist/ へトランスパイル（テンプレート一式も dist/templates/ へコピー）
```

### 実行方法（2通り）

**A. `node bin/run.js` で直接実行**（ビルド後、追加のインストール操作なしで試せる）

```bash
node bin/run.js \
  --dir "docs/spec:仕様書" \
  --target dir \
  --out ./dist-preview
```

**B. `npm link` でグローバルに `doc-shipper` コマンドとして使う**

```bash
npm link          # このリポジトリの bin を doc-shipper コマンドとして登録
cd /path/to/other-repo
doc-shipper --dir "docs/spec:仕様書" --target dir --out ./dist-preview
# 不要になったら: npm unlink -g doc-shipper
```

> nodenv / rbenv 系のバージョン管理を使っている場合、`npm link` 直後は shim が未生成で
> `command not found: doc-shipper` になることがあります。その場合は `nodenv rehash` を実行してください。

いずれの方法でも、上記「使い方」節のオプション（`--dir` / `--target` / `--auth` 等）はそのまま使えます。まず認証やデプロイを伴わない `--target dir` で `./dist-preview` に出力し、生成された `index.html` をブラウザで開いて確認するのが手早い動作確認方法です。

### コード変更時のループ

```bash
npm run dev         # tsup --watch（保存するたびに dist/ を再ビルド）
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

`npm run dev` を起動したまま、別ターミナルで `node bin/run.js ...`（または `npm link` 済みなら `doc-shipper ...`）を実行すれば、コード変更を都度反映しながら試せます。

### 現状の制約

- `cloudflare` ターゲットへの実デプロイは動作確認済みです。**`vercel` ターゲットは実デプロイ未検証**です（`vercel` CLI の実機テストが必要）。認証やデプロイを伴わないローカル確認には `dir` / `zip` ターゲットも使えます。
- 実装の詳細な進捗・既知の課題は [`documents/progress.md`](documents/progress.md) を参照してください。

実装は TypeScript / ESM で行い、ビルドは `tsup`（`bundle: false` でディレクトリ構造を保ったままトランスパイル）を使用しています。

## ライセンス

[MIT](LICENSE)
