# 実装進捗ログ

`documents/spec.md` を正典として実装した内容・判断・残課題の記録。更新のたびに追記する（古い内容は削除せず追記型で残す）。

## 2026-09-14: Cloudflare への実デプロイ成功を確認

上記のマルチアカウント対応（`CLOUDFLARE_ACCOUNT_ID` 自動解決）修正後、ユーザーが実機で `--target cloudflare` を再実行し、**Cloudflare Pages への実デプロイが成功した**ことを確認。これにより `cloudflare` ターゲットは実機検証済みとなった（`_worker.js` によるBasic認証込みのエンドツーエンドの動作を含む）。

- **まだ未検証**: `vercel` ターゲットの実デプロイ（Vercel CLI・実アカウントでの検証は未実施のまま）。
- `README.md` / `CLAUDE.md` の `cloudflare`/`vercel` 併記の未検証表記を、cloudflareのみ検証済みに更新した（下記「2026-09-14: 初回実装」節内の記載はその時点のスナップショットとして原文のまま残す）。

## 2026-09-14: 実機での初回Cloudflareデプロイテストで発見したバグの修正

ユーザーが実際に `--target cloudflare` を実行し、以下で停止することを報告してくれた。

```
✖ Command failed with exit code 1: wrangler pages project list
✘ [ERROR] More than one account available but unable to select one in non-interactive mode.
  Please set the appropriate `account_id` in your Wrangler configuration file or assign it to the `CLOUDFLARE_ACCOUNT_ID` environment variable.
  Available accounts are (`<name>`: `<account_id>`):
    `Agenda23@gmail.com's Account`: `59367e98606e7cc0734c621d4dcf73b5`
    `Masuofx@gmail.com's Account`: `50775492882c8b11c547dcfffc6f7b7a`
```

**原因**: ユーザーが複数のCloudflareアカウントを持っている場合、`wrangler` はサブプロセス実行（`execa`経由、TTYなし）を非対話モードとみなし、アカウントを自動選択できずにエラーになる。`src/preflight.ts` の `preflightCloudflare` は `CLOUDFLARE_API_TOKEN`（非対話時）の有無しかチェックしておらず、この「アカウントが複数ある」ケースを想定していなかった。

**修正**（`src/preflight.ts`）:
- `wrangler pages project list` を preflight 段階で一度試行し、失敗した場合はエラーメッセージから `More than one account available` パターンを検出する `parseMultiAccountError` を追加。
- アカウント一覧をエラーメッセージから正規表現で抽出（`` `<name>`: `<account_id>` `` 形式）。
- 対話環境（TTY）では `@clack/prompts` の `select` でユーザーにアカウントを選ばせ、選ばれた `accountId` を以降のすべての `wrangler` 呼び出しに `CLOUDFLARE_ACCOUNT_ID` 環境変数として自動付与するようランナーをラップする。
- 非対話環境（CI等）では、検出したアカウント候補を列挙した上で `CLOUDFLARE_ACCOUNT_ID` を明示するよう促すエラーメッセージに変更（以前は `CLOUDFLARE_API_TOKEN` のみ言及していた）。

**検証の限界（正直に記録）**: このマシンには実際の `wrangler` と実際のCloudflareアカウントがあるため、ユーザーの環境を安全に再現するテストが書けなかった。`parseMultiAccountError` はユーザーが実際に受け取ったエラーメッセージ全文をそのままテストケース（`src/preflight.test.ts`）にして抽出結果を検証済み（2アカウントとも正しく抽出できることを確認）。一方で、`CLOUDFLARE_ACCOUNT_ID` 付与後に実際に `wrangler pages project list` が成功するか、対話プロンプトが実機で正しく表示されるかは**実機で再検証が必要**。
また検証中、PATHに偽の `wrangler` を割り込ませて非TTY時の分岐を試した際、意図せず実際にインストール済みの本物の `wrangler` が呼ばれ、ダミートークンでCloudflare APIへ実通信が発生した（認証失敗で終わり実害はないが、望ましくない実行だった）。以降、実CLIを操作する検証は行わず、ユーザーによる実機再テストに委ねる方針とする。

- **既知の未対応事項**: Vercel（`vercel deploy`）でも複数チーム所属時に同様の非対話選択エラーが起きる可能性があるが、実際のエラーメッセージ形式を確認できていないため、Cloudflareと同様の対処は未実装（`documents/spec.md` 上の要件でもない）。同様の報告があれば対応する。

## 2026-09-14: npm公開手順のドキュメント化 + 公開準備

`documents/publishing.md` を新規作成し、npm公開の前提条件・チェックリスト・実行手順・公開後のドキュメント更新・トラブルシューティングをまとめた。作成にあたり以下を実機で確認した。

- パッケージ名 `doc-shipper` は npm レジストリ上でまだ未使用（`npm view doc-shipper` → 404）。ただし §9.1 の通り正式な空き確認・最終承認はまだ得ていないため、公開前に要再確認。
- このマシンは npm 未ログイン（`npm whoami` → `ENEEDAUTH`）。
- GitHubリモートは `git@github.com:agenda23/doc-shipper.git`。これを基に `package.json` に `repository`/`homepage`/`bugs`/`keywords` を追加した。

公開準備の過程で `npm pack --dry-run` を実際に実行し、**`dist/core/tree.test.js` / `dist/util.test.js`（および対応する `.map`）が誤って配布物に混入する不具合**を発見した。`tsup.config.ts` の `entry` が `src/**/*.ts` のままだとテストファイルもトランスパイル対象になり、`"files": ["bin", "dist"]` 経由でパッケージに同梱されてしまうため、`entry: ["src/**/*.ts", "!src/**/*.test.ts"]` に修正して除外した（修正後 `npm pack --dry-run` でテストファイルが含まれないことを確認済み）。

また `package.json` に `prepublishOnly`（`typecheck && test && build` を自動実行）を追加し、壊れた状態のまま誤って公開されることを防ぐようにした。

## 2026-09-14: README に「開発中の使用方法」セクションを追加

npm未公開のため `npx doc-shipper`（README「使い方」節）はまだ動作しない。ローカルでの試し方（`npm install && npm run build` の後、`node bin/run.js ...` または `npm link` で `doc-shipper` コマンドとして使う）をREADMEに追記した。

- 実際に `npm link` → 別ディレクトリで `doc-shipper --dir ... --target dir` を実行して動作することを確認した。
- 確認の過程で、**nodenv 管理下の環境では `npm link` 直後は shim が未生成で `command not found` になり、`nodenv rehash` が別途必要**なことが分かったため、README に注記を追加した（nodenv固有の挙動で doc-shipper 自体のバグではない）。

## 2026-09-14: 初回実装（v1 コア機能一式）

### やったこと

`package.json` / `tsconfig.json` / `tsup.config.ts` / `bin/run.js` を新規作成し、spec.md §5.1 のモジュール構成に沿って `src/` を実装した。TypeScript(ESM) + tsup（`bundle:false` でディレクトリ構造保持のままトランスパイル）でビルドできる状態。

| モジュール | 対応する仕様 | 状態 |
|---|---|---|
| `src/types.ts` / `src/util.ts` | 共通型・ユーティリティ | 実装済み |
| `src/core/collector.ts` | §3.1・§8.4（fast-glob収集、既定除外、重複排除） | 実装済み |
| `src/core/resolver.ts` | §3.2・§7.1〜§7.3（リンク/アセット解決、パストラバーサル対策） | 実装済み |
| `src/core/parser.ts` | §2・§8.3（marked + shiki、GFM標準機能のみ） | 実装済み |
| `src/core/tree.ts` | §3.3・§7.4（サイドバーツリー、order/自然順ソート） | 実装済み |
| `src/core/builder.ts` | §5.1・§5.2・§6.3（HTML生成、一時ディレクトリ運用） | 実装済み |
| `src/cli/args.ts` | §4.1（commander、`--dir`/`--auth`パース） | 実装済み |
| `src/cli/config.ts` | §4.3（`.doc-shipper.json` 読み書き、秘密キー除去） | 実装済み |
| `src/cli/resolve.ts` | §4.3・§7.6（CLI>設定>対話>既定値のマージ、project/title導出） | 実装済み |
| `src/cli/interactive.ts` | §4.2（@clack/prompts 対話フロー） | 実装済み（実TTYでの動作確認は未実施） |
| `src/preflight.ts` | §6.2・§7.7（wrangler/vercel存在確認、npxフォールバック） | 実装済み（実CLIに対する動作確認は未実施） |
| `src/targets/cloudflare.ts` / `vercel.ts` | §3.4・§6.1・§8.1・§8.2 | 実装済み（**実デプロイは未検証**、後述） |
| `src/targets/local-dir.ts` / `zip.ts` | §3.4・§6.3・§7.5 | 実装済み・動作確認済み |
| `src/targets/worker-template.ts` | §6.1・§7.5・§8.1（env版/埋め込み版の `_worker.js`、Vercel middleware） | 実装済み |
| `src/templates/*` | §3.3（2ペインレイアウト、ライト/ダーク、アコーディオン、ドロワー） | 実装済み・動作確認済み |

### 動作確認したこと（実際にビルド・実行して確認、結果は本文参照ではなくこのログが一次情報）

`/tmp` に作った最小フィクスチャ（ルートREADME + `docs/spec/README.md` + `docs/spec/auth.md`（frontmatter title/order・コードブロック・画像参照つき））に対して `node bin/run.js` を実行し、以下を確認した。

- ページ生成・出力パス保持（`docs/spec/auth.md` → `docs/spec/auth.html`）
- フロントマター `title` の反映、サイドバーの並び順（`order`昇順・自然順ソート）
- ルートREADMEからの内部リンクが `../docs/spec/auth.md` → `docs/spec/auth.html` へ拡張子変換のみで解決されること
- 画像がSHA-256先頭8桁でハッシュ化され `/assets/images/xxx-xxxxxxxx.png` に集約されること
- shiki によるコードハイライトが実際に色付きHTMLとして出力されること（後述のバグ修正後）
- サイドバーツリー（ルートREADME固定表示、`--dir`ラベルをセクション見出しに使用、現在ページへの `is-current` 付与）
- ルートREADME無効時のリダイレクトページ生成（`meta refresh` + `canonical`）
- スコープ外リンク（選択していないディレクトリ）・ルート外パストラバーサルの検出と警告
- `--strict` 指定時に警告がエラーとしてビルド全体を中断すること（全違反をまとめて報告してから中断）
- 大文字小文字違いによる出力パス衝突の検出（実装のみ、テストケースは未追加）
- `dir` ターゲット: `--auth` 指定時に `_worker.js`（認証情報を直接埋め込み）が同梱され、平文埋め込みの警告が出ること
- `zip` ターゲット: 上記一式が ZIP アーカイブされること
- `.doc-shipper.json` の `--save-config` 書き出し・次回実行時の自動読み込み・秘密キー（`auth`）が警告付きで無視されること
- 非TTY環境で `--dir` 未指定時、`--auth` 未指定でのデプロイ系ターゲット指定時に、対話にフォールバックせず明確なエラーで中断すること

### 自動テスト

`vitest` を導入し、`src/util.test.ts`（slugify・自然順ソート・href分解・外部URL判定・出力パス変換）と `src/core/tree.test.ts`（サイドバーツリーの並び順・index固定・ネスト構造）を追加。`npm test` で15件全て pass。ビルド確認は上記の手動スモークテストが中心で、自動テストのカバレッジは主要ロジックの一部に留まる（後述の残課題）。

### 実装中に見つかった仕様との齟齬・実装判断

1. **`marked` はカスタム `Renderer` の戻り値を await しない**（`async: true` が待機するのは `walkTokens` のみ、`Parser.parse` 内は同期的に `out += this.renderer.code(token)` としているだけ）。spec §7.8/§8.3 は `marked.use({ async: true })` で shiki の非同期ハイライトを統合する前提だったが、これは `renderer.code` を async にするだけでは動作せず（`[object Promise]` が出力される実バグを実機確認で検出）、**walkTokens の段階で shiki のハイライト結果を事前計算してトークンに埋め込み、renderer.code では同期的に読み出すだけにする**方式に変更した（`src/core/parser.ts`）。spec の記述自体は誤りではない（非同期統合は可能）が、実装の勘所（どこで await するか）が仕様文面より一段階詳細な実装判断を要した。
2. **`--strict` 時にリンク解決エラーを `walkTokens` 内で即座に throw すると、marked の `onError` ハンドラに横取りされ「Please report this to marked」という誤解を招くメッセージが付与される**ことを実機確認で検出。`Resolver` は常に警告を記録するだけにし、`builder.ts` が全ドキュメント処理後にまとめて `--strict` 判定・中断するよう変更した。副作用として、**最初の違反1件で即中断ではなく、全違反をまとめて報告してから中断する**（spec の要求を満たしつつ、むしろUX上の改善）。
3. `tsup` は既定でバンドル（単一ファイル化）するが、`builder.ts` が `import.meta.url` 基準の相対パスでテンプレート（`layout.html`/`styles.css`/`sidebar.js`）を実行時に読むため、バンドルすると本番(`dist/index.js`一つ)と開発(`src/`のファイル構造)でテンプレートへの相対パスがズレる問題があった。`tsup.config.ts` を `bundle: false`（ディレクトリ構造を保ったままトランスパイル）に変更し、`dist/` が `src/` と同じ相対構造を保つようにして解決した。

### 未実装・未検証の項目（次にやるべきこと）

- **Cloudflare / Vercel への実デプロイは未検証。** `wrangler` / `vercel` CLI の実機テストを行っていないため、`src/preflight.ts` の `wrangler --version` パース、`wrangler pages secret put` / `vercel env add` の stdin 渡し（§8.1）、`wrangler pages project create` のフラグ（`--production-branch`）等は仕様書とCLIヘルプからの推定実装であり、実CLIでの動作確認が必要。
- `src/cli/interactive.ts` は実際のTTYセッションで一度も動かしていない（@clack/prompts のAPI呼び出し形は目視確認のみ）。特に `multiselect` の `required:false` 挙動、`password` プロンプトの表示等は要確認。
- 大文字小文字違いによる出力パス衝突（§7.1）の自動テストが無い。
- Windows環境（パス区切り、`--dir` のドライブレター誤分割対策）は未検証（開発機がmacOSのため）。
- npm の依存パッケージに中〜重大度の脆弱性が4件（`vitest`/`esbuild`/`vite` 系、開発時のみ使用するdevDependency）。`npm audit fix --force` は vitest の破壊的更新を伴うため今回は見送った。本番実行には影響しないが、CI導入時に対応を検討する。
- E2Eテスト（実際に `wrangler`/`vercel` のモック/スタブを使った統合テスト）が無い。
- `README.md` に記載の内容は元々の想定インターフェースの説明であり、実装後の細部（エラーメッセージ文言等）との完全な一致は未確認。

### 既知の設計判断メモ（実装時に自明でなかった点）

- サイドバーの各ディレクトリの「自分自身」（README.md/index.md）は兄弟一覧に出さず、親ノードの `href` として表現する（`tree.ts` の `buildLevel` の `selfIndex` 分離ロジック）。
- 内部リンク（`.md`同士）は出力構造がソース構造と完全一致することを利用し、パステーブルを持たず文字列変換のみで解決している（`resolver.ts`）。一方アセット（画像・添付）はハッシュベースで `/assets/` に集約するため、こちらは絶対パスを都度再構築している。
- 実装候補ディレクトリの対話UI（`interactive.ts` の `discoverCandidateDirs`）は、直接 `.md` を含むディレクトリを候補として列挙する簡易探索であり、spec のモック例（`docs/spec`, `architecture` 等）を再現する厳密なアルゴリズムとして明文化されたものではない（spec自体もアルゴリズムを規定していない）。
