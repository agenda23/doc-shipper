# ドキュメント共有CLIツール（仮称 doc-shipper）機能・システム仕様書

## 1. 概要

### 1.1 背景

GitHubのプライベートリポジトリ内にあるMarkdownドキュメント（仕様書、設計書など）を、GitHubアカウントを所有していない社外関係者や特定メンバーへ安全に共有したいニーズが存在する。しかし、GitHub公式の権限モデルではアカウントレスの閲覧共有ができない。また、リポジトリ全体ではなく「ドキュメントフォルダのみ」を抜粋して見せたいケースが多い。

### 1.2 目的

対象リポジトリ内に余計な設定ファイルを作らず（リポジトリを汚さず）、指定した複数のドキュメントディレクトリを自動解析してGitHubライクなUIの静的Webサイトを生成し、Basic認証付きで即座にクラウドへデプロイまたはローカル出力（ディレクトリ/ZIP）できるNode.js製CLIツールを提供する。

### 1.3 主要な特徴

- **Zero Config in Repo**: 対象リポジトリ側に設定ファイルの追加を一切**要求しない**（引数と対話のみで完結できる）。繰り返し利用の利便性のため、**秘密情報を含まない**設定ファイル（`.doc-shipper.json`）を任意で保存することは可能（§4.3）。ビルド成果物・一時ファイル・キャッシュは一切残さない（§6.3）。
    
- **マルチディレクトリ統合**: 散らばったドキュメント階層を1つの仮想ドキュメントサイトとして再構成。
    
- **ルートREADME連携**: デフォルトでリポジトリ直下の `README.md` をトップページ（`/`）に設定。
    
- **画像・相対リンクの完全自動解決**: 相対参照されている画像の実体探索、衝突防止ハッシュ化、HTMLパスの自動リライト。
    
- **マルチターゲット出力**: Cloudflare Pages、Vercel、ローカルディレクトリ、ZIP配布に対応。
    
- **Basic認証の自動統合**: Cloudflare `_worker.js` などを動的生成し、静的アセット全体を保護。
    
- **デュアルインターフェース**: 引数なしでのリッチな対話型CUIと、CI/CDで使えるコマンドラインオプションの両立。
    

## 2. 技術スタック

|分類|選定技術 / パッケージ|用途・選定理由|
|---|---|---|
|**ランタイム / 言語**|Node.js (v20 LTS以上) / TypeScript|移植性、型安全性、エコシステムの充実（v18は2025年4月にEOLのため対象外とする）|
|**CLI インターフェース**|`commander`|コマンドライン引数・オプション解析（`cac`と比較検討の上、エコシステムの成熟度を優先して確定）|
|**対話型プロンプト**|`@clack/prompts`|モダンで視認性の高いCUIターミナル操作|
|**Markdown パース**|`marked`|高速かつ `walkTokens` フックが豊富なパーサー。`marked.use({ async: true })` で `shiki` の非同期ハイライトを統合する|
|**シンタックスハイライト**|`shiki`|GitHubと同等のTextMate文法による正確なハイライト|
|**フロントマター**|`gray-matter`|YAML フロントマター（`title` / `order`）の抽出|
|**Markdown スタイル**|`github-markdown-css`|GitHubのレンダリングスタイルを完全再現|
|**ファイル走査**|`fast-glob`|対象ディレクトリ内の `.md` 収集（画像・添付は resolver が参照から個別探索）|
|**アーカイブ生成**|`archiver`|ZIP出力ターゲット用圧縮ライブラリ|
|**CLI / デプロイ実行**|`execa`|Wrangler CLI / Vercel CLI などの外部プロセス実行|

パッケージは ESM（`package.json` に `"type": "module"`）で構成する（`shiki` v1+ / `marked` v12+ / `@clack/prompts` はいずれも ESM 専用）。ビルドは `tsup`（esbuild ベース）で `bin/run.js`（shebang 付き）と `dist/` を生成する。

## 3. 機能要件

### 3.1 入力とソース解決

1. **複数ディレクトリの選択**
    
    - 任意のパスを複数指定可能（例: `docs/spec`, `architecture`, `packages/core/docs`）。
        
    - 各ディレクトリに対して、サイドバー表示用の「セクション名（表示ラベル）」を付与可能。ラベルはサイドバーのセクション見出し表示にのみ使用し、URL には影響しない。
        
2. **出力パスの生成規則（リポジトリ構造を保持）**
    
    - 各ドキュメントの出力パスは、**プロジェクトルート**（`--root`、既定は実行時のカレントディレクトリ）からの相対パスをそのまま用い、拡張子のみ `.md` → `.html` に変換する。ディレクトリ構造は改変しない（例: `docs/spec/auth.md` → `/docs/spec/auth.html`）。
        
    - この方式により、ディレクトリ名の衝突は原理的に発生せず、内部リンク解決は拡張子変換のみで済む（§3.2）。
        
    - `--dir` に指定するパスはプロジェクトルート配下でなければならない（ルート外・絶対パス・`../` による脱出は不可。該当時はエラー）。
        
    - 各ディレクトリの `README.md` および `index.md` は、そのディレクトリの `index.html` として出力する。
        
    - 親子関係にある複数ディレクトリを指定した場合（例: `docs` と `docs/spec`）、重複するファイルは同一の出力パスに解決されるため単純に重複排除する。
        
3. **ルート README.md の取り込み**
    
    - プロジェクトルートに存在する `README.md` をトップページ（`/index.html`）として扱う（デフォルト: 有効）。README 内の相対リンクはプロジェクトルート基準でそのまま解決できる。
        
    - オプトアウトされた場合、または存在しない場合は、最初の `--dir` の先頭ドキュメント（§3.3 の並び順で先頭）へ誘導する `/index.html` を生成する（`<meta http-equiv="refresh">` + `<link rel="canonical">` + 本文にリンク）。
        

### 3.2 アセット解決・リンク書き換えパイプライン

1. **画像・添付ファイル解決（Asset Pipeline）**
    
    - Markdown構文（`![alt](path)`）およびHTMLタグ（`<img src="path">`）からローカルパスを抽出。
        
    - パス解決の基準: 相対パスは対象Markdownのあるディレクトリ、`/` 始まりの絶対パスは**プロジェクトルート**基準で実ファイルを探索する。
        
    - **ハッシュ**: ファイル内容の SHA-256 先頭8桁（16進）を用い、`[baseName]-[hash:8].[ext]` にリネームして集約する（画像は `/assets/images/`、それ以外の添付は `/assets/files/`）。内容が同一のファイルは同一ハッシュに解決されるため自動的に重複排除される。
        
    - レンダリング時、`src` / リンク属性を出力先Webルート基準の絶対パス（`/assets/images/...`, `/assets/files/...`）へ書き換える。
        
    - **参照先が見つからない場合**: 既定は警告を出して原文のまま継続（壊れたリンクを残す）。`--strict` 指定時はエラーで停止する。
        
    - **パストラバーサル**: 解決結果がプロジェクトルート外を指す場合は解決せず警告する（`--strict` でエラー）。シンボリックリンクは既定で辿らない。
        
    - ※ 外部URL（`http://`, `https://`, `//`）およびData URIは書き換え対象外。
        
2. **内部リンク解決**
    
    - 出力構造がリポジトリ構造と一致するため（§3.1）、`.md` への相対リンクは**拡張子を `.html` に変換するだけ**でよい（例: `[仕様](../spec/auth.md)` → `../spec/auth.html`）。`README.md` / `index.md` へのリンク、およびディレクトリへのリンク（`[x](../design/)`）は当該ディレクトリの `index.html` に解決する。
        
    - フラグメント（`#section`）・クエリは保持し、パス部分のみ変換する。
        
    - `.md` 以外へのリンク（`./data.csv` など）は添付ファイルとして 1. のパイプラインで処理し、`/assets/files/...` へリンクを書き換える。
        
    - リンク先が収集対象外（選択されていないディレクトリの `.md`）またはプロジェクトルート外を指す場合は、リンクを書き換えず原文のまま残し、警告を出す（`--strict` 時はエラー）。
        
    - この制限は単なるリンク切れ防止ではなくセキュリティ上の理由による。本ツールはプライベートリポジトリの一部のみを外部公開する用途を前提とするため、指定ディレクトリ群の境界を越えた画像・リンクの自動取り込みは既定で禁止し、意図しない情報漏洩（非公開ディレクトリの内容の巻き込み）を防止する。
        

### 3.3 UI・レイアウト生成

1. **2ペイン レイアウト**
    
    - **左サイドバー**:
        
        - ルートREADME（有効時）を先頭に固定。
            
        - `--dir` ごとに 1 セクション（見出しはラベル、未指定時はディレクトリの basename）。セクション内はサブディレクトリ階層をネストしたアコーディオンで表示する。
            
        - サイドバーは全 HTML ページにプリレンダして埋め込む（no-JS / SEO 対応）。`sidebar.js` はアコーディオンの開閉、現在ページのハイライト、モバイル時のドロワー開閉、開閉状態の `localStorage` 永続化のみを担当する。
            
    - **右メインコンテンツ**:
        
        - GitHubスタイル（`markdown-body` クラス適用）
            
        - レスポンシブ対応（モバイル時はドロワーサイドバー）
            
2. **ページタイトルと並び順**:
    
    - 各 `.md` は先頭の YAML フロントマターを `gray-matter` で抽出する（本文には描画しない）。
        
    - ページタイトルの決定順: フロントマター `title` → 本文最初の `H1` → ファイル名（拡張子除去）。
        
    - サイドバー内の並び順: フロントマター `order`（昇順）を最優先し、未指定分は数値プレフィックスを考慮した自然順ソート（`10-x.md` が `2-x.md` の後）。各ディレクトリの `README.md` / `index.md` は常にそのディレクトリの先頭に置く。
        
3. **テーマ**:
    
    - ライト / ダークモード切替（OS設定連動 + トグルボタン）。選択状態は `localStorage` に保存し、FOUC 防止のため `<head>` 内インラインスクリプトで初期テーマを適用する。
        

### 3.4 出力ターゲット（Providers）

|ターゲット (`--target`)|認証方式|動作仕様|
|---|---|---|
|**`cloudflare`**|`_worker.js` によるBasic認証|ビルド成果物内にエッジWorkerを生成し、`wrangler pages deploy` を実行。|
|**`vercel`**|Edge Middleware|`middleware.ts` を生成し（`vercel.json` 単体ではBasic認証は不可）、`vercel deploy --prod` を実行。matcher で静的アセットを含む全パスを保護する。|
|**`dir`**|ホスティング先に依存|指定パス（`--out`）に静的HTML・アセット群・認証ハンドラ（`_worker.js` 等）を出力。認証はデプロイ先で別途有効化が必要。|
|**`zip`**|ホスティング先に依存|`dir` の出力一式を指定パス（`--out`）にZIPアーカイブ。|

> ⚠️ `dir` / `zip` は静的ファイルを出力するだけであり、それ自体では Basic 認証は機能しない。認証ハンドラを同梱するが、対応するホスティング環境（Cloudflare Pages / Vercel 等）へ配置して初めて有効になる。詳細は §7.5。

## 4. CLI インターフェース仕様

### 4.1 コマンドライン引数（非対話・CI/CD用）

```
doc-shipper [options]
```

#### 主なオプション一覧

|オプション|型|デフォルト値|説明|
|---|---|---|---|
|`-d, --dir <path[:label]>`|string[]|(なし)|対象ドキュメントディレクトリ（複数指定可。ラベル指定対応）。プロジェクトルート配下に限る|
|`--root <path>`|string|(カレントディレクトリ)|出力パスの基準となるプロジェクトルート|
|`-t, --target <provider>`|string|`cloudflare`|出力先 (`cloudflare`, `vercel`, `dir`, `zip`)|
|`-p, --project <name>`|string|(下記の導出順)|デプロイ先プロジェクト名（DNSセーフに slug 化）。表示名は `--title`|
|`--strict`|boolean|`false`|参照先未解決・パストラバーサル・対象外リンクを警告でなくエラーにする|
|`-a, --auth <user:pass>`|string|(なし)|Basic認証のIDとパスワード（最初の `:` で分割。パスワード側の `:` は許容）。環境変数 `DOC_SHIPPER_AUTH` でも可。設定ファイルには保存されない|
|`-o, --out <path>`|string|`./dist`|出力先パス (`dir`, `zip` ターゲット時)|
|`--config <path>`|string|`<root>/.doc-shipper.json`|読み込む設定ファイル（§4.3）|
|`--no-config`|boolean|-|設定ファイルが存在しても無視する|
|`--save-config`|boolean|`false`|実行後、非秘密設定を `.doc-shipper.json` に保存する|
|`--title <name>`|string|`--project` の値|サイドバー等に表示するサイトタイトル（`--project` はデプロイ名として slug 化される）|
|`--include-readme` / `--no-include-readme`|boolean|`true`|ルートの `README.md` をトップに含めるか（`--no-` 接頭辞で無効化）|
|`--allow-public`|boolean|`false`|`--auth` 未指定のままデプロイ系ターゲットを実行することを許可|
|`-h, --help`|-|-|ヘルプメッセージを表示|

#### パース仕様・デフォルト値の導出

- **`--dir <path[:label]>`**: ラベルは**最後の `:`** で分割する。ただし最後の `:` より後ろにパス区切り（`/` または `\`）を含む場合はラベルなし（トークン全体をパスとみなす）とし、Windows のドライブレター（`C:\docs`）を誤分割しない。
- **`--auth <user:pass>`**: **最初の `:`** で分割し、パスワード側の `:` を許容する。
- **`--project` のデフォルト**: `<root>/package.json` の `name` → `git config --get remote.origin.url` から導出したリポジトリ名 → `--root` ディレクトリの basename、の順。`.git` が無くても動作する。デプロイ名は小文字英数とハイフン（63文字以内）に slug 化する。
- **`--title` のデフォルト**: `--project` に**明示指定された値**（slug 化前）。未指定時は `--project` と同じ導出順の生値。
- **部分指定時の挙動**: 一部オプションのみ指定した場合、不足分のみ対話プロンプトで補完する。**TTY が無い環境（CI 等）では対話にフォールバックせず、必須項目（`--dir`、デプロイ系での `--auth` または `--allow-public`）の欠如をエラーにする。**

#### 実行例

```
# Cloudflare Pages への直接デプロイ
npx doc-shipper \
  --dir "docs/spec:仕様書" \
  --dir "architecture:アーキテクチャ" \
  --target cloudflare \
  --project my-secure-spec \
  --auth "client:secretpass"

# 配布用ZIPの出力
npx doc-shipper \
  --dir "docs/spec:仕様書" \
  --target zip \
  --out ./exported-docs.zip
```

### 4.2 対話型モード（オプション省略時）

引数なしで実行した場合、ターミナル上で対話型プロンプトが起動する。オプションを一部だけ指定した場合は不足分のみ対話で補完する。ただし TTY が無い環境（CI 等）では対話にフォールバックせず、不足オプションはエラーとする（§7.6）。

```
┌  doc-shipper (v1.0.0)
│
◇  Select documentation directories to include:
│  [x] docs/spec
│  [x] architecture
│  [ ] src/
│  [x] packages/core/docs
│
◇  Enter labels for the directories:
│  - docs/spec: 仕様書
│  - architecture: 設計資料
│  - packages/core/docs: コアモジュール仕様
│
◇  Include root README.md as the homepage?
│  ● Yes (default)
│  ○ No
│
◇  Select output target:
│  ● Cloudflare Pages
│  ○ Vercel
│  ○ Export to Directory
│  ○ Export as ZIP
│
◇  Set Basic Auth (leave empty for none):
│  Username: admin
│  Password: **********
│
◇  Project / Site Name:
│  my-private-docs
│
◇  Save these settings to .doc-shipper.json for next time? (auth is never saved)
│  ● Yes
│  ○ No (default)
│
◐  Building documentation site...
│  ✔ Parsed 24 markdown files
│  ✔ Resolved and copied 6 images
│  ✔ Injected Cloudflare Basic Auth Worker
│  ✔ Wrote .doc-shipper.json
│
◐  Deploying to Cloudflare Pages...
│  ✔ Deployment complete
│
└  🚀 Live URL: [https://my-private-docs.pages.dev](https://my-private-docs.pages.dev)
   Credentials: admin / **********
```

### 4.3 設定ファイル（`.doc-shipper.json`、任意）

繰り返し利用（ドキュメント更新のたびの再デプロイ等）の負担を減らすため、`--root` 直下に置く JSON 設定ファイルを**任意で**サポートする。存在すれば自動的に読み込む。無くても全機能が動作する（設定ファイルを「要求」はしない）。

#### 保存してよい項目・禁止する項目

| 保存可 | `dirs`（`path` と `label`）, `includeReadme`, `target`, `project`, `title`, `out`, `strict` |
|---|---|
| **保存禁止** | Basic 認証のユーザー / パスワード、各種 API トークン、その他の秘密情報 |

- `auth` 等の秘密情報に相当するキーが設定ファイルに含まれている場合、**その値は無視し、警告を表示する**（誤って平文の秘密情報がコミットされる事故を防ぐ）。
- 認証情報は常に `--auth` / 環境変数（`DOC_SHIPPER_AUTH="user:pass"`、または `BASIC_AUTH_USER` / `BASIC_AUTH_PASS`）/ 対話プロンプトのいずれかから取得する。

#### 例

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

#### 設定値の優先順位

`CLI 引数` > `.doc-shipper.json` > `対話プロンプトでの補完` > `既定値`

（認証情報のみ別系統: `--auth` > 環境変数 > 対話プロンプト。設定ファイルからは決して読まない）

#### 関連オプション

| オプション | 説明 |
|---|---|
| `--config <path>` | 読み込む設定ファイルのパスを明示（既定: `<root>/.doc-shipper.json`） |
| `--no-config` | 設定ファイルが存在しても無視する |
| `--save-config` | 実行後、解決済みの非秘密設定を `.doc-shipper.json` に書き出す（対話モードでは確認プロンプトで代替） |

#### コミットの扱い

`.doc-shipper.json` は秘密情報を含まないため、チーム / CI で共有する目的でリポジトリにコミットしてよい。共有したくない場合は各自の `.gitignore` に追加する。ツールはどちらも強制しない。

## 5. システムアーキテクチャ & ディレクトリ構成

### 5.1 モジュール構成

```
doc-shipper/
├── bin/
│   └── run.js                  # CLIエントリポイント
├── src/
│   ├── index.ts                # オーケストレーター
│   ├── cli/
│   │   ├── args.ts             # Commander定義
│   │   ├── config.ts           # .doc-shipper.json の読み込み・秘密キー除去・書き出し
│   │   ├── resolve.ts          # CLI引数 / 設定ファイル / 対話 / 既定値のマージ（優先順位）
│   │   └── interactive.ts      # @clack/prompts による対話UI
│   ├── core/
│   │   ├── collector.ts        # fast-glob による .md 収集・フロントマター抽出・重複排除
│   │   ├── resolver.ts         # 「元パス → 出力パス / アセットパス」対応表の構築、アセットのハッシュ集約
│   │   ├── parser.ts           # marked(async) + walkTokens で shiki ハイライトと resolver の対応表適用
│   │   ├── tree.ts             # サイドバー仮想ツリー構造生成（タイトル決定・並び順）
│   │   └── builder.ts          # layout.html への流し込み・静的HTML出力
│   ├── targets/
│   │   ├── cloudflare.ts       # _worker.js 生成 & Wrangler呼び出し
│   │   ├── vercel.ts           # middleware.ts 生成 & Vercel CLI呼び出し
│   │   ├── local-dir.ts        # 指定フォルダ出力
│   │   └── zip.ts              # archiver によるZIP出力
│   ├── templates/
│   │   ├── layout.html         # 基本HTMLシェル（サイドバー、メイン）
│   │   ├── styles.css          # レイアウトCSS + github-markdown-css
│   │   └── sidebar.js          # アコーディオン開閉・現在地ハイライト・ドロワー・localStorage永続化
│   └── preflight.ts            # wrangler / vercel CLI の存在・バージョン・認証チェック
└── package.json
```

**責務分離**: `resolver` は解決の計算（対応表の構築とアセット集約）に徹し、実際のリンク・`src` 書き換えは `parser` が `walkTokens` の中で対応表を参照して行う。`shiki` のハイライトは非同期のため `marked.use({ async: true })` を前提とする。

### 5.2 出力アセット構造（一時ビルド / ディレクトリ出力時）

出力パスはプロジェクトルートからの相対パスをそのまま保持する（§3.1）。

```
dist/ (または OS一時ディレクトリ)
├── index.html                  # ルートREADME（または先頭ページへのリダイレクト）
├── docs/
│   └── spec/
│       ├── api.html
│       └── db.html
├── architecture/
│   └── system.html
├── packages/
│   └── core/
│       └── docs/
│           └── index.html      # packages/core/docs/README.md
├── assets/
│   ├── styles.css
│   ├── sidebar.js
│   ├── images/                 # 内容ハッシュで集約・重複排除した画像群
│   │   ├── flow-a1c2e4.png
│   │   └── arch-8b9f1d.png
│   └── files/                  # .md 以外の添付ファイル（同じハッシュ規則）
│       └── sample-9f3b2c.csv
└── _worker.js                  # (Cloudflare ターゲット時のみ / env から認証情報を読む)
```

## 6. 詳細処理仕様

### 6.1 Basic認証（Cloudflare `_worker.js`）の実装仕様

静的アセット（画像やスクリプトを含む）への直接アクセスも保護するため、すべてのリクエストをインターセプトするWorkerをルート直下に配置する。

```js
export default {
  async fetch(request, env) {
    // 認証情報は env（Cloudflare の Secret / Vercel の Environment Variable）から読み込む。
    // ビルド成果物には埋め込まない。
    const user = env.BASIC_AUTH_USER;
    const pass = env.BASIC_AUTH_PASS;
    const expected = "Basic " + toBase64(`${user}:${pass}`);
    const authHeader = request.headers.get("Authorization") ?? "";

    if (!timingSafeEqual(authHeader, expected)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Protected Documentation"',
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
```

> **実装上の注意（詳細は §7.5）**
>
> - `__USER__` / `__PASS__` をビルド時に平文置換する方式は `dir` / `zip` 出力時に認証情報が成果物へ露出する。`cloudflare` / `vercel` へのデプロイ時は Worker の環境変数（Secret）として設定し、成果物・Git 履歴・CI ログに残さない。
> - 認証ヘッダの比較は**定数時間比較**（`timingSafeEqual` 相当）を用いる。`!==` は文字列長・内容でタイミング差が出る。
> - `btoa` は Latin-1 のみ対応のため、非 ASCII を含むパスワードは `TextEncoder` でバイト列化してから Base64 エンコードする（`toBase64`）。
> - 非対話モードで `cloudflare` / `vercel` かつ `--auth` 未指定の場合、`--allow-public` が無ければデプロイを中断する。

### 6.2 デプロイ前チェック（Preflight）

`cloudflare` / `vercel` ターゲット実行時、ビルド開始前に以下を検証する。

- **CLI の存在とバージョン**: `wrangler --version`（**v3 以上**。`pages deploy` サブコマンドを使用。v2 の `pages publish` は非対応でエラー）、`vercel --version` を確認。未導入の場合は `npx wrangler@latest` / `npx vercel@latest` へ自動フォールバックし、その旨を通知する。
- **認証状態**: 対話環境では `wrangler whoami` / `vercel whoami` で確認し、未ログインならログイン方法を案内する。CI 環境では以下の環境変数を子プロセスへ引き渡す:
    - Cloudflare: `CLOUDFLARE_API_TOKEN`（必須）、`CLOUDFLARE_ACCOUNT_ID`
    - Vercel: `VERCEL_TOKEN`（必須）、`VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`
- **プロジェクトの存在**: Cloudflare は `wrangler pages project list` に `--project` が無ければ `wrangler pages project create <name>` で作成する。Vercel は `vercel deploy` が未作成プロジェクトを自動生成するため事前作成は不要。

### 6.3 クリーンアップ仕様

- すべてのターゲット（`cloudflare`, `vercel`, `dir`, `zip`）において、静的サイトの生成そのものは常に OS のテンポラリディレクトリ（`os.tmpdir()`）上で行う。`--out` や作業リポジトリへ直接書き出すことはしない。
    
    - `cloudflare` / `vercel` はテンポラリディレクトリから直接デプロイする。
        
    - `dir` ターゲットは生成完了後、テンポラリディレクトリの内容を `--out` へコピーする。
        
    - `zip` ターゲットは生成完了後、テンポラリディレクトリの内容を `--out` へアーカイブする。
        
- デプロイ・出力処理の成否に関わらず（デプロイ失敗時や途中での異常終了を含む）、`try/finally` 相当の制御でテンポラリディレクトリを必ず削除する。これにより、失敗時に `--out` へ不完全な成果物が残ることも防ぐ。
    
- 生成した静的サイト・一時ファイル・キャッシュはリポジトリ内に一切残さない。
    
- 例外は `--save-config` / 対話での同意により明示的に書き出す `.doc-shipper.json` のみ（秘密情報を含まない。§4.3）。ツールが暗黙に設定ファイルを作成することはない。

## 7. 設計判断ログ（初版レビューでの決定事項）

初版仕様のレビューで検出した矛盾・未定義事項と、それぞれに対して確定した方針。詳細は各本文セクションに反映済み。

### 7.1 出力パスの生成規則（→ §3.1・§3.2・§5.2）

**リポジトリ構造を保持する。** 出力パスはプロジェクトルート（`--root`、既定は CWD）からの相対パスをそのまま用い、拡張子のみ `.md` → `.html` に変換する。これにより basename 衝突は原理的に発生しない。

- `--dir` がプロジェクトルート外・絶対パス・`../` 脱出を含む場合はエラー。
- 各ディレクトリの `README.md` / `index.md` はそのディレクトリの `index.html` にマッピングする。
- 親子ディレクトリ同時指定時は同一出力パスに解決されるため重複排除する。
- 大文字小文字を区別しないファイルシステムで異なる原パスが同一出力パスに衝突する場合はエラーで通知する。

### 7.2 ルート README 内リンク（→ §3.2）

7.1 により出力構造がリポジトリ構造と一致するため、README 内リンクもプロジェクトルート基準でそのまま解決できる（拡張子変換のみ）。

- リンク先が収集対象外の `.md` またはルート外を指す場合は書き換えず原文のまま残し警告（`--strict` でエラー）。
- ディレクトリへのリンク（`[x](../design/)`）は当該ディレクトリの `index.html` へ解決する。

### 7.3 アセット・内部リンク解決のエッジケース（→ §3.2）

- **パストラバーサル**: 解決結果がプロジェクトルート外を指す場合は解決せず警告（`--strict` でエラー）。シンボリックリンクは既定で辿らない。
- **参照先が見つからない場合**: 既定は警告して継続（壊れたリンクを残す）、`--strict` で停止。
- **ハッシュの入力**: ファイル内容の SHA-256 先頭8桁。内容が同一のファイルは自動的に重複排除される。
- **絶対パス参照**（`/img/x.png`）: プロジェクトルート基準で解決する。
- **`.md` 以外への相対リンク**（`.csv` 等）: 添付ファイルとして `/assets/files/` に集約し、リンクを書き換える。
- **フラグメント / クエリ付きリンク**: パス部分のみ書き換え、フラグメントを保持する。

### 7.4 ページタイトルと並び順（→ §3.3）

- ページタイトル: フロントマター `title` → 本文最初の `H1` → ファイル名（拡張子除去）。フロントマターは `gray-matter` で抽出し本文には描画しない。
- サイドバーの並び順: フロントマター `order`（昇順）を最優先、未指定分は数値プレフィックスを考慮した自然順ソート。各ディレクトリの `README.md` / `index.md` は先頭固定。
- サブディレクトリ階層はネストしたアコーディオンで表示する。

### 7.5 認証情報の取り扱い（→ §6.1）

- `cloudflare` / `vercel` デプロイ時は Basic 認証のユーザー/パスワードを Worker 環境変数（Cloudflare: Secret、Vercel: Environment Variable）として設定し、生成コードは `env` から読む。成果物・Git 履歴・CI ログに残さない。
- `dir` / `zip` 出力では認証情報がハンドラ内に平文で残るため、実行時に警告する。
- 認証ヘッダの比較は定数時間比較。
- 非 ASCII を含むパスワードは `TextEncoder` でバイト列化してから Base64 エンコードする。
- 非対話モードで `cloudflare` / `vercel` かつ `--auth` 未指定の場合、`--allow-public` が無ければ中断する。

### 7.6 CLI オプションのパースと対話モードの併用（→ §4.1）

- `--auth <user:pass>` は最初の `:` で分割（パスワード側の `:` 許容）。
- `--dir <path[:label]>` は最後の `:` で分割。最後の `:` より後ろにパス区切りを含む場合はラベルなし（Windows ドライブレター対策）。
- 部分指定時は不足分のみ対話補完。TTY が無ければ対話にフォールバックせず必須項目の欠如をエラーにする。
- `--project` のデフォルト: `<root>/package.json` の `name` → git remote から導出 → `--root` の basename。deploy 名は slug 化。
- 表示タイトルは `--title`（`--project` の slug 化前の値が既定）として分離する。

### 7.7 デプロイ実行の前提条件（→ §6.2）

- `wrangler`（v3+）/ `vercel` CLI の存在・バージョン・認証状態を preflight で検証。未導入時は `npx <pkg>@latest` へ自動フォールバック。
- CI 用認証情報は環境変数（`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `VERCEL_TOKEN` 等）を子プロセスへ引き渡す。
- Cloudflare のプロジェクトが未作成なら `wrangler pages project create` で作成。Vercel は自動生成。

### 7.8 実装スタックの前提（→ §2・§5.1）

- `marked.use({ async: true })` + `walkTokens` で `shiki` の非同期ハイライトと resolver の対応表適用を行う。
- 責務分離: `resolver` は対応表の構築とアセット集約、`parser` は `walkTokens` 内での書き換え。
- パッケージは ESM（`"type": "module"`）、ビルドは `tsup`、`bin/run.js` は shebang 付き。
- `sidebar.js` は `src/templates/` に配置し、開閉・ハイライト・ドロワー・`localStorage` 永続化のみを担当。サイドバー本体は全 HTML にプリレンダする。
- `fast-glob` は `.md` 収集のみ。画像・添付は resolver が参照から個別に探索する。

### 7.9 繰り返し利用と設定ファイルの扱い（→ §1.3・§4.3・§6.3）

- 「設定ファイルを残さない」原則は「ツールが**要求・暗黙生成しない**」ことを意味する。ドキュメント更新のたびの再実行を楽にするため、**秘密情報を含まない** `.doc-shipper.json`（選択ディレクトリ・ラベル・ターゲット・プロジェクト名等）を**オプトイン**で保存できる。
- Basic 認証情報・API トークンは設定ファイルに書けない。該当キーがあれば無視して警告する。認証情報は `--auth` / 環境変数 / 対話のみ。
- 優先順位: CLI 引数 > `.doc-shipper.json` > 対話補完 > 既定値。
- ビルド成果物・一時ディレクトリは従来どおり一切残さない（§6.3）。

### 7.10 実装スタック・クリーンアップ方式の追加確定（→ §2・§6.3）

- ランタイムは Node.js v18+ から **v20 LTS 以上**に変更（v18 は 2025年4月に EOL のため対象外）。
- CLI パーサーは `commander` に確定（`cac` とは比較検討済み。エコシステムの成熟度を優先）。
- クリーンアップ方式を統一: `dir` / `zip` ターゲットも `cloudflare` / `vercel` と同様、常に一時ディレクトリ（`os.tmpdir()`）でビルドしてから `--out` へコピー/アーカイブする。失敗時に `--out` へ不完全な成果物を残さないため。テンポラリディレクトリの削除は成否によらず `try/finally` 相当で保証する。
- スコープ外参照（§3.2）を書き換えず警告する制限は、単なるリンク切れ防止ではなく「プライベートリポジトリの一部のみを公開する」という前提に基づくセキュリティ対策である旨を明記。

### 7.11 その他

- README 無効時のリダイレクトページは `<meta http-equiv="refresh">` + `<link rel="canonical">` + 本文リンクで生成（→ §3.1）。
- テーマ選択状態は `localStorage` に保存、FOUC 防止のため `<head>` 内インラインスクリプトで初期適用（→ §3.3）。
- パッケージ名 `doc-shipper`（仮称）は npm での名前の空きを確認のうえ確定する（未着手）。

## 8. 実装着手前の追加確定事項

実装を開始するにあたり、既存仕様だけでは技術的に一意に決まらず手戻りの原因になり得た点を、このタイミングで確定する。

### 8.1 Basic認証シークレットの設定方法（→ §6.1・§6.2）

- **Cloudflare**: `execa` で `wrangler pages secret put BASIC_AUTH_USER --project-name <project>` を起動し、値はコマンドライン引数ではなく**子プロセスの stdin** に書き込んで渡す（引数で渡すと `ps` 等のプロセス一覧経由で他ユーザーに値が漏洩し得るため）。`BASIC_AUTH_PASS` も同様に別コマンドで設定する。
- **Vercel**: 同様の理由で `vercel env add BASIC_AUTH_USER production` を stdin 経由で非対話実行する。`VERCEL_TOKEN` が環境変数にある場合は `--token` を付与する。
- 両コマンドとも標準出力・標準エラー出力・ツール自身のログに値をエコーしない（`execa` の出力を認証値についてはマスクするか、そもそも表示しない）。
- デプロイ完了後の対話モードのサマリー表示（§4.2）でパスワードをマスクしたまま表示している設計は維持する（共有相手には別途安全な手段で伝達する前提とし、平文表示はしない）。

### 8.2 Vercel デプロイ用の静的サイト設定（→ §3.4・§5.1）

- ビルド成果物ディレクトリ直下に最小限の `vercel.json` を生成し、フレームワーク自動検出を無効化する: `{ "framework": null, "buildCommand": null, "outputDirectory": "." }`。これを行わないと `vercel deploy --prod` が静的HTMLディレクトリに対して誤ったフレームワーク検出・ビルドを試みる恐れがある。
- `middleware.ts` は Vercel のデプロイパイプラインが自動的にトランスパイルするため、追加のビルド設定は不要。

### 8.3 Markdown/GFM拡張のサポート範囲（→ §2・§3.3）

- `marked` は `gfm: true`（既定値）を用い、テーブル・タスクリスト・自動リンクのみをサポート対象とする。
- footnote（脚注）、Mermaid等の図表、絵文字ショートコード（`:smile:` 記法）は初版のスコープ外とする（§9.3 参照）。GitHub上での見た目と完全一致はしない前提を明示する。

### 8.4 ファイル走査時の除外パターン（→ §2・§5.1）

- `fast-glob` で `.md` を収集する際、既定で `node_modules/**`、`.git/**`、生成された `.doc-shipper.json` 自身、および `.` から始まる隠しディレクトリ（`--dir` に明示指定されたパス自体は除く）を除外する。
- 除外パターンをカスタマイズする CLI オプションは初版では提供しない（必要になれば `--exclude` の追加を検討。§9.4）。

### 8.5 `--dir` の重複指定時の挙動（→ §3.1・§4.1）

- 同一パスが複数回指定された場合はエラーにせず、**最後に指定されたラベル**を採用する（後勝ち）。
- 異なるパスが同一の出力パスに解決される場合（親子ディレクトリ同時指定など）は既存の重複排除規則（§3.1・§7.1）に従う。

## 9. 初版スコープ外として確定した事項

プロダクトオーナー判断により、以下は初版（v1）では対応しないことを確定する。将来的に必要になれば改めて検討するが、現時点では実装・設計の対象に含めない。

### 9.1 パッケージ名の確定

`doc-shipper`（仮称）のまま変更しない。npm上での名前の空き確認・正式名称化は初版では行わない。

### 9.2 Basic認証以外の保護手段

IP許可リストやOAuth等、Basic認証以外の保護方式は初版では実装しない。認証方式はBasic認証のみとする（§3.4・§6.1）。

### 9.3 GFM拡張の対応範囲

footnote（脚注）・Mermaid等の図表・絵文字ショートコード（`:smile:` 記法）は初版では対応しない。§8.3の通り `gfm: true` の標準機能（テーブル・タスクリスト・自動リンク）のみをサポート範囲とする。

### 9.4 大規模リポジトリでの性能

ビルド時間の目標値の設定、および §8.4 の既定除外パターンをユーザーがカスタマイズする手段（`--exclude` 等）は初版では検討しない。