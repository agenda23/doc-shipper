# ドキュメント共有CLIツール（仮称 doc-shipper）機能・システム仕様書

## 1. 概要

### 1.1 背景

GitHubのプライベートリポジトリ内にあるMarkdownドキュメント（仕様書、設計書など）を、GitHubアカウントを所有していない社外関係者や特定メンバーへ安全に共有したいニーズが存在する。しかし、GitHub公式の権限モデルではアカウントレスの閲覧共有ができない。また、リポジトリ全体ではなく「ドキュメントフォルダのみ」を抜粋して見せたいケースが多い。

### 1.2 目的

対象リポジトリ内に余計な設定ファイルを作らず（リポジトリを汚さず）、指定した複数のドキュメントディレクトリを自動解析してGitHubライクなUIの静的Webサイトを生成し、Basic認証付きで即座にクラウドへデプロイまたはローカル出力（ディレクトリ/ZIP）できるNode.js製CLIツールを提供する。

### 1.3 主要な特徴

- **Zero Config in Repo**: 対象リポジトリ側にビルド設定ファイル（設定jsonやconfig.js）の追加を一切要求しない。
    
- **マルチディレクトリ統合**: 散らばったドキュメント階層を1つの仮想ドキュメントサイトとして再構成。
    
- **ルートREADME連携**: デフォルトでリポジトリ直下の `README.md` をトップページ（`/`）に設定。
    
- **画像・相対リンクの完全自動解決**: 相対参照されている画像の実体探索、衝突防止ハッシュ化、HTMLパスの自動リライト。
    
- **マルチターゲット出力**: Cloudflare Pages、Vercel、ローカルディレクトリ、ZIP配布に対応。
    
- **Basic認証の自動統合**: Cloudflare `_worker.js` などを動的生成し、静的アセット全体を保護。
    
- **デュアルインターフェース**: 引数なしでのリッチな対話型CUIと、CI/CDで使えるコマンドラインオプションの両立。
    

## 2. 技術スタック

|分類|選定技術 / パッケージ|用途・選定理由|
|---|---|---|
|**ランタイム / 言語**|Node.js (v18+) / TypeScript|移植性、型安全性、エコシステムの充実|
|**CLI インターフェース**|`commander` または `cac`|コマンドライン引数・オプション解析|
|**対話型プロンプト**|`@clack/prompts`|モダンで視認性の高いCUIターミナル操作|
|**Markdown パース**|`marked`|高速かつ拡張フック（ウォーカー）が豊富なパーサー|
|**シンタックスハイライト**|`shiki`|GitHubと同等のTextMate文法による正確なハイライト|
|**Markdown スタイル**|`github-markdown-css`|GitHubのレンダリングスタイルを完全再現|
|**ファイル走査**|`fast-glob`|複数ディレクトリ内の `.md` および画像抽出|
|**アーカイブ生成**|`archiver`|ZIP出力ターゲット用圧縮ライブラリ|
|**CLI / デプロイ実行**|`execa`|Wrangler CLI / Vercel CLI などの外部プロセス実行|

## 3. 機能要件

### 3.1 入力とソース解決

1. **複数ディレクトリの選択**
    
    - 任意のパスを複数指定可能（例: `docs/spec`, `architecture`, `packages/core/docs`）。
        
    - 各ディレクトリに対して、サイドバー表示用の「セクション名（表示ラベル）」を付与可能。
        
2. **ルート README.md の取り込み**
    
    - リポジトリルートに存在する `README.md` をトップページ（`/index.html`）として扱う（デフォルト: 有効）。
        
    - オプトアウトされた場合、または存在しない場合は、指定ディレクトリ内の先頭ドキュメントへ自動リダイレクトするページを生成。
        

### 3.2 アセット解決・リンク書き換えパイプライン

1. **画像解決（Image Asset Pipeline）**
    
    - Markdown構文（`![alt](path)`）およびHTMLタグ（`<img src="path">`）からローカル画像パスを抽出。
        
    - 対象Markdownが存在するディレクトリからの相対パスを基に、実ファイルを探索。
        
    - 画像ファイル名を衝突防止ルール（`[baseName]-[hash:8].[ext]`）に基づきリネームし、共通アセットディレクトリ（`/assets/images/`）へ集約配置。
        
    - レンダリング時、HTML側の `src` 属性を出力先Webルート基準の絶対パス（`/assets/images/...`）へ自動書き換え。
        
    - ※ 外部URL（`http://`, `https://`）およびData URIは書き換え対象外。
        
2. **内部リンク解決**
    
    - Markdown間での相対リンク（例: `[仕様](../spec/auth.md)`）を、ビルド後のHTML構造（例: `/spec/auth.html`）へ動的リライト。
        

### 3.3 UI・レイアウト生成

1. **2ペイン レイアウト**
    
    - **左サイドバー**:
        
        - ルートREADME（有効時）
            
        - 複数ディレクトリを統合した仮想ツリー（アコーディオン形式 / 階層表示）
            
    - **右メインコンテンツ**:
        
        - GitHubスタイル（`markdown-body` クラス適用）
            
        - レスポンシブ対応（モバイル時はドロワーサイドバー）
            
2. **テーマ**:
    
    - ライト / ダークモード切替（OS設定連動またはトグルボタン）。
        

### 3.4 出力ターゲット（Providers）

|ターゲット (`--target`)|認証方式|動作仕様|
|---|---|---|
|**`cloudflare`**|`_worker.js` によるBasic認証|ビルド成果物内にエッジWorkerを生成し、`wrangler pages deploy` を実行。|
|**`vercel`**|Edge Middleware|`middleware.js` または `vercel.json` を生成し、`vercel deploy --prod` を実行。|
|**`dir`**|静的ファイル + 各種Config|指定パス（`--out`）に静的HTML、アセット群、Worker定義を出力。|
|**`zip`**|配布用アーカイブ|指定パス（`--out`）に静的サイト一式をZIPファイルとしてアーカイブ。|

## 4. CLI インターフェース仕様

### 4.1 コマンドライン引数（非対話・CI/CD用）

```
doc-shipper [options]
```

#### 主なオプション一覧

|オプション|型|デフォルト値|説明|
|---|---|---|---|
|`-d, --dir <path[:label]>`|string[]|(なし)|対象ドキュメントディレクトリ（複数指定可。ラベル指定対応）|
|`-t, --target <provider>`|string|`cloudflare`|出力先 (`cloudflare`, `vercel`, `dir`, `zip`)|
|`-p, --project <name>`|string|(リポジトリ名)|デプロイ先プロジェクト名 / サイトタイトル|
|`-a, --auth <user:pass>`|string|(なし)|Basic認証のIDとパスワード|
|`-o, --out <path>`|string|`./dist`|出力先パス (`dir`, `zip` ターゲット時)|
|`--include-readme`|boolean|`true`|ルートの `README.md` をトップに含めるか|
|`--no-include-readme`|boolean|-|ルートREADMEを含めない|
|`-h, --help`|-|-|ヘルプメッセージを表示|

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

引数なしで実行した場合、ターミナル上で対話型プロンプトが起動する。

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
◐  Building documentation site...
│  ✔ Parsed 24 markdown files
│  ✔ Resolved and copied 6 images
│  ✔ Injected Cloudflare Basic Auth Worker
│
◐  Deploying to Cloudflare Pages...
│  ✔ Deployment complete
│
└  🚀 Live URL: [https://my-private-docs.pages.dev](https://my-private-docs.pages.dev)
   Credentials: admin / **********
```

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
│   │   └── interactive.ts      # @clack/prompts による対話UI
│   ├── core/
│   │   ├── collector.ts        # ディレクトリ探索・ファイル一覧抽出
│   │   ├── resolver.ts         # 画像・相対リンクの解決・リライト
│   │   ├── parser.ts           # Marked + Shiki によるMarkdownパース
│   │   ├── tree.ts             # サイドバー仮想ツリー構造生成
│   │   └── builder.ts          # 静的HTMLのレンダリング・出力
│   ├── targets/
│   │   ├── cloudflare.ts       # _worker.js 生成 & Wrangler呼び出し
│   │   ├── vercel.ts           # Vercel設定生成 & Vercel CLI呼び出し
│   │   ├── local-dir.ts        # 指定フォルダ出力
│   │   └── zip.ts              # archiver によるZIP出力
│   └── templates/
│       ├── layout.html         # 基本HTMLシェル（サイドバー、メイン）
│       └── styles.css          # レイアウトCSS + github-markdown-css
└── package.json
```

### 5.2 出力アセット構造（一時ビルド / ディレクトリ出力時）

```
dist/ (または OS一時ディレクトリ)
├── index.html                  # ルートREADME（または先頭ページへのリダイレクト）
├── spec/
│   ├── api.html
│   └── db.html
├── architecture/
│   └── system.html
├── assets/
│   ├── styles.css
│   ├── sidebar.js
│   └── images/                 # 集約された画像群
│       ├── flow-a1c2e4.png
│       └── arch-8b9f1d.png
└── _worker.js                  # (Cloudflare Pages用 Basic認証ハンドラ)
```

## 6. 詳細処理仕様

### 6.1 Basic認証（Cloudflare `_worker.js`）の実装仕様

静的アセット（画像やスクリプトを含む）への直接アクセスも保護するため、すべてのリクエストをインターセプトするWorkerをルート直下に配置する。

```
export default {
  async fetch(request, env) {
    const expected = "Basic " + btoa("__USER__:__PASS__");
    const authHeader = request.headers.get("Authorization");

    if (authHeader !== expected) {
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

### 6.2 クリーンアップ仕様

- デプロイターゲット（`cloudflare`, `vercel`）実行時、OSのテンポラリディレクトリ（`os.tmpdir()`）を利用して静的サイトを生成する。
    
- デプロイ完了後、テンポラリディレクトリは自動的に削除される。
    
- リポジトリ内には一切の生成ファイル、キャッシュ、設定ファイルを残さない。