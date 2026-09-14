# npm 公開手順

`doc-shipper` を npm レジストリに公開するための手順書。実行前に必ず本ドキュメント全体を確認すること。

## 0. 前提として確認済みの事実（2026-09-14 時点）

- パッケージ名 `doc-shipper` は npm レジストリ上でまだ**誰にも取得されていない**（`npm view doc-shipper` → `404 Not Found` を確認済み）。ただし公開作業を始めるタイミングで改めて確認すること（時間が経つと状況が変わりうる）。
- このマシンでは npm に**ログインしていない**（`npm whoami` → `ENEEDAUTH`）。公開には事前に `npm login`（または `npm adduser`）が必要。
- GitHub リモートは `git@github.com:agenda23/doc-shipper.git`（`package.json` の `repository`/`homepage`/`bugs` フィールドはこの URL を基に設定済み）。
- 現在のバージョンは `0.1.0`（`package.json`）。まだ一度も公開されていない（初回公開）。
- `documents/spec.md` §9.1 の決定により、パッケージ名の正式な空き確認・改名検討は初版（v1）ではスコープ外とされている。**つまり `doc-shipper` という名前で公開してよいという明示的な最終承認はまだ得ていない**。初回 `npm publish` の実行前に、この名前で進めてよいか改めて関係者に確認すること。
- `documents/progress.md` の通り、`cloudflare` ターゲットへの実デプロイは実機で成功確認済み（複数アカウント環境での`CLOUDFLARE_ACCOUNT_ID`自動解決含む）。**`vercel` への実デプロイは引き続き未検証**。公開するCLIの一部機能（vercel）が未検証のままであることを認識した上で、公開のタイミング（正式版 `1.0.0` として出すか、`0.x.y` のプレリリースとして先出しするか）を判断すること。

## 1. 公開前チェックリスト

以下を **すべて** 満たしてから公開作業に入る。

- [ ] `npm run typecheck` が通る
- [ ] `npm test` が通る
- [ ] `npm run build` が通り、`dist/` が生成される
- [ ] `npm pack --dry-run` の出力を確認し、余計なファイル（テストファイル、`.env`、ローカル専用の設定など）が含まれていないこと
      - 現在の `package.json` の `"files": ["bin", "dist"]` により、リポジトリ直下の `documents/` や `src/`（TypeScriptソース）は同梱されない。CLI利用者には `dist/` のビルド済みJSのみ配布される。
      - `dist/**/*.test.js` が混入していないこと（`tsup.config.ts` の entry で `!src/**/*.test.ts` を除外済みだが、新しいテストファイルを追加した際は再確認する）
- [ ] `README.md` の内容が現状と乖離していないか（特に「使い方」節の `npx doc-shipper` の例、CLIオプション一覧）
- [ ] `LICENSE` ファイルが存在する（存在確認済み。中身がプレースホルダのままでないか目視確認）
- [ ] `package.json` の `version` が公開したいバージョンになっている（初回は `0.1.0` のままでよいか、`1.0.0` にするか判断。§2 参照）
- [ ] Basic認証・APIトークンなど秘密情報がソースやテンプレートに埋め込まれていないこと（`git grep -i -E "password|secret|token" -- src` 等で軽く確認）
- [ ] `vercel` ターゲットが未検証であることをREADME等で利用者に伝えているか（`cloudflare`は実機確認済み。誤って「両方とも動作保証済み」と誤解されないように）

## 2. バージョン番号の決め方

npm の [semver](https://semver.org/lang/ja/) 規約に従う。

| 変更内容 | 上げる番号 | コマンド例 |
|---|---|---|
| 破壊的変更（CLIオプションの削除・挙動変更等） | major | `npm version major` |
| 後方互換な機能追加 | minor | `npm version minor` |
| バグ修正のみ | patch | `npm version patch` |

- **初回公開**は `0.1.0`（現状）のまま出すか、正式版として `1.0.0` にするかを判断する。`vercel`の実デプロイが未検証な段階では、**`0.x.y` のまま公開し「実験的」であることを明示する**方が安全（semverの慣習上、`0.x` はAPI/CLI仕様が安定していないことを示す）。
- `npm version <major|minor|patch>` は `package.json` の `version` を更新し、`git commit` + `git tag vX.Y.Z` を自動で作成する（`package-lock.json` があればそちらも更新される）。事前に作業ツリーがクリーンである必要がある（コミットされていない変更があると失敗する）。

## 3. 初回公開の手順

```bash
# 1. 作業ツリーがクリーンであることを確認
git status

# 2. npm にログイン（初回のみ / セッション切れ時）
npm login
npm whoami   # ログインユーザー名が表示されることを確認

# 3. 公開前チェック（prepublishOnly スクリプトが typecheck → test → build を自動実行するが、
#    事前に手動でも流して問題を早期発見する）
npm run typecheck
npm test
npm run build

# 4. 実際にパッケージに含まれる内容を確認（公開はしない）
npm pack --dry-run
# もしくは実ファイルとして生成して中身を展開確認したい場合:
npm pack
tar -tzf doc-shipper-*.tgz
rm doc-shipper-*.tgz

# 5. 公開（--dry-run で最終リハーサル → 問題なければ本番実行）
npm publish --dry-run
npm publish --access public
```

- スコープなしパッケージ名（`doc-shipper`。`@scope/doc-shipper` ではない）は npm 上デフォルトで public 公開になるが、`--access public` を明示しておくと誤って有料プライベート公開を試みて失敗する事故を防げる。
- npm アカウントで2要素認証（2FA、特に "Authorization for both write and publish" 設定時）が有効な場合、`npm publish` 実行時にワンタイムパスコード（OTP）の入力を求められる。認証アプリ（Google Authenticator等）を手元に用意しておくこと。
- `prepublishOnly` スクリプト（`package.json` に設定済み: `npm run typecheck && npm test && npm run build`）が `npm publish` 実行前に自動で走る。ここで失敗すると公開は中断される（＝壊れた状態のまま誤って公開されることはない）。

## 4. 公開後の確認

```bash
# レジストリに反映されたか確認（反映まで数分かかることがある）
npm view doc-shipper

# 実際にインストールして動作確認（グローバルインストールではなく npx を推奨）
npx doc-shipper@latest --help
```

- README の「使い方」節にある `> [!NOTE]` の「npm未公開」注記を削除する（このドキュメントの§5参照）。
- GitHub 側で `git push --tags`（`npm version` で作成したタグをリモートに反映）と、必要であれば GitHub Releases でのリリースノート作成を行う。
- `documents/progress.md` に公開日時・バージョン・公開時に判明した問題を追記する（進捗ログの運用ルールに従う）。

## 5. 公開に伴うドキュメント更新

公開が完了したら、以下のドキュメントの「未公開」を前提にした記述を更新すること。

- `README.md`:
  - 冒頭の `> [!NOTE]` の「実装中です」を、公開後の状態に合わせて更新する。
  - 「使い方」節の `> [!NOTE]`（npm未公開の注記）を削除するか、実際に動作する状態になったことを明記する。
  - 「開発中の使用方法」節は、公開後も開発者向けの手順として引き続き有用なため残してよい（見出しを「ローカル開発」等に変える程度の調整は任意）。
- `CLAUDE.md` の「現状」節を、公開済みである旨に更新する。
- `documents/spec.md` §9.1（パッケージ名確定は初版スコープ外、という記述）は、実際に公開した段階で「確定済み」に更新するか、公開バージョンへの参照を追記する。

## 6. 2回目以降のバージョンアップ手順

初回公開後の通常のリリースフローは以下の繰り返しになる。

```bash
git status                       # クリーンであることを確認
npm run typecheck && npm test && npm run build   # 事前確認（任意、prepublishOnlyでも走る）
npm version patch                # または minor / major。package.json更新 + commit + タグ作成
npm publish                      # prepublishOnly が自動実行される
git push && git push --tags      # コミットとタグをリモートに反映
```

## 7. トラブルシューティング

| 症状 | 対処 |
|---|---|
| `npm publish` が `403 Forbidden` | 別の誰かが同名パッケージを既に公開している可能性（§0の確認が古くなっている）。`npm view doc-shipper` で再確認し、必要ならパッケージ名の変更を検討 |
| `npm publish` が `ENEEDAUTH` | `npm login` でログインし直す |
| OTPを求められるが認証アプリが無い | npmアカウントの2FA設定を事前に確認し、認証アプリを登録しておく（公開作業の当日に慌てないよう事前準備） |
| `prepublishOnly` で失敗する | エラー内容に従って `typecheck` / `test` / `build` のいずれかを個別に実行し原因を特定してから再度 `npm publish` |
| 誤って壊れたバージョンを公開してしまった | npm は公開後72時間以内なら `npm unpublish doc-shipper@<version>` で取り消せるが、**強く非推奨**（依存している別プロジェクトを壊す）。基本は新しいpatchバージョンを公開して修正する方針を取る |

## 8. 将来的な自動化（未実施・検討事項）

現時点ではCI/CDからの自動publishは構築していない。将来的にGitHub Actionsで `git tag` push をトリガーに `npm publish` を自動実行する場合は、以下を検討すること（このドキュメントの範囲外の作業のため、着手時に別途整理する）。

- npm の [Trusted Publishing（OIDC経由、npmトークン不要）](https://docs.npmjs.com/trusted-publishers) の利用検討（長期的なトークン漏洩リスクを避けられる）
- 現状は手動での `npm login` + `npm publish` を前提とした運用とする
