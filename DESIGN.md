# markdown-table-poster 設計仕様

Slack-hosted（Run on Slack / Deno Slack SDK）で動作する、Markdown テーブルを
リッチなテーブルとして投稿する Slack アプリの設計仕様。

リポジトリ: https://github.com/t2y-kage/markdown-table-poster

---

## 1. 目的と方針

- フォームに貼り付けた **Markdown テーブル**を、Slack 上でレンダリングされた
  リッチなテーブルとして投稿する。
- **運用・保守コストを最小化**する。外部サーバーを持たず、Slack 社のマネージド
  インフラ（Run on Slack）上で完結させ、ランニングコストをゼロにする。
- 認証情報をチャット等に露出させない。コミット／デプロイは開発者のローカル環境
  または GitHub Actions（Secrets 経由）から行う。

---

## 2. 採用アプローチ（方式A: markdown ブロック）

Block Kit の `markdown` ブロックは標準的な Markdown を渡すと Slack 側でレンダリング
する。サポート記法に**テーブルが含まれており**、`| 見出し | ... | / | --- | ... |`
形式がフォーマット済みテーブルとして描画される。

→ フォームで受け取った Markdown テーブル文字列を**パースせずそのまま** `markdown`
ブロックの `text` に渡して `chat.postMessage` するだけでよい。最小コード・最小保守。

参照: https://docs.slack.dev/reference/block-kit/blocks/markdown-block

### 不採用にした代替案（必要時の拡張候補）

- `table` ブロック / `data_table` ブロック: 列揃え・折り返し・セル内リンク・
  ソート/フィルタなど制御性は高いが、Markdown を行・セル構造へパースする実装が
  必要で保守対象が増える。将来要件が出たら移行を検討。
  - table block: https://docs.slack.dev/reference/block-kit/blocks/table-block
  - data table block: https://docs.slack.dev/reference/block-kit/blocks/data-table-block

---

## 3. アーキテクチャ

Run on Slack の 3 要素（Trigger → Workflow → Function）で構成する。

```
Link(Shortcut) Trigger
    └─ Workflow (interactivity 必須)
         ├─ Step1: OpenForm        … Markdown テーブル + 投稿先チャンネルを収集
         └─ Step2: Custom Function … markdown ブロックで chat.postMessage
                                       （任意で Datastore に監査ログ保存）
```

設計上の要点:

- 投稿は組み込み `SendMessage` ではなく**カスタムファンクション経由**で行う。
  `SendMessage` は任意の `blocks` を渡せないため、`markdown` ブロックを使うには
  カスタムファンクションから `client.chat.postMessage` を直接呼ぶ必要がある。
- OpenForm を使うため Workflow には `interactivity` 入力が必須。フォームが意図せず
  開くのを防ぐ仕組みで、OpenForm は最初のステップに置く。
- 起動チャンネルを投稿先の既定値としてトリガーから渡す。

参照:
- フォーム作成: https://docs.slack.dev/tools/deno-slack-sdk/guides/creating-a-form/
- API 呼び出し: https://docs.slack.dev/tools/deno-slack-sdk/guides/calling-slack-api-methods/
- トリガー: https://docs.slack.dev/tools/deno-slack-sdk/guides/using-triggers/

---

## 4. コンポーネント仕様

### manifest.ts
- workflows / functions / datastores を登録。
- botScopes:
  - `chat:write` … メッセージ投稿
  - `chat:write.public` … 未参加のパブリックチャンネルへも投稿可能にする
  - `datastore:read` / `datastore:write` … 監査ログ用（任意機能。不要なら削除）

### triggers/post_markdown_table_trigger.ts
- `TriggerTypes.Shortcut`（Link トリガー）。
- 生成された Shortcut URL をチャンネルに貼る／ブックマークして起動。
- inputs: `interactivity`, `channel`(= 起動チャンネル) を Workflow に渡す。

### workflows/post_markdown_table.ts
- input_parameters: `interactivity`(必須), `channel`(任意)。
- Step1 `Schema.slack.functions.OpenForm`:
  - `channel`: channel_id（既定値 = トリガーの channel）
  - `markdown`: string, `long: true`（複数行入力）
- Step2 カスタムファンクション: `channel`, `markdown`, `submitted_by` を渡す。

### functions/post_markdown_table/definition.ts
- inputs: `channel`(channel_id), `markdown`(string), `submitted_by`(user_id)
- outputs: `ts`(string)

### functions/post_markdown_table/mod.ts
- `client.chat.postMessage` に `blocks: [{ type: "markdown", text: markdown }]` と
  フォールバック `text` を渡す。
- 投稿成功後、任意で Datastore に監査ログを put（失敗してもログのみで投稿成否に
  影響させない）。

### datastores/posted_tables.ts（任意）
- primary_key: `id`
- attributes: `id`, `channel`, `markdown`, `submitted_by`, `posted_ts`, `created_at`
- 監査ログ／将来の重複防止・レビュー用途。不要なら manifest から外す。

---

## 5. プロジェクト構成

```
markdown-table-poster/
├── manifest.ts
├── workflows/
│   └── post_markdown_table.ts
├── functions/
│   └── post_markdown_table/
│       ├── definition.ts
│       └── mod.ts
├── triggers/
│   └── post_markdown_table_trigger.ts
├── datastores/
│   └── posted_tables.ts          # 任意
├── assets/
│   └── icon.png                  # 要追加
├── deno.jsonc                    # 要追加（CLI スキャフォールド）
├── import_map.json               # 要追加
├── slack.json                    # 要追加
├── .gitignore                    # 既存（要補完）
├── LICENSE                       # 既存（MIT）
└── README.md
```

---

## 6. 制約・注意点

- **markdown ブロックの型**: `deno-slack-sdk` の型定義が `markdown` ブロックに
  未追随の場合、`type: "markdown"` で型エラーになり得る。回避策は (a) blocks を
  キャスト、または (b) `client.apiCall("chat.postMessage", {...})` を使う。
- **文字数上限の不一致**: OpenForm の文字列フィールドはおおむね 3,000 文字が上限。
  一方 `markdown` ブロックは 1 ペイロード合計 12,000 文字まで。大きなテーブルは
  フォーム入力では収まらないため、分割するか外部 Webhook トリガー版を検討。
- **タイムアウト**: デプロイ済みファンクションは 60 秒、View インタラクションは 10 秒。
- **レンダリング確認**: `markdown` ブロックのテーブル描画は対象クライアント／
  ワークスペースで実機確認する。
- **実行環境**: `slack run` / `slack deploy` はローカルの Slack CLI から行う。

---

## 7. 実装タスク（Claude Code 用チェックリスト）

- [ ] 既存リポジトリに上記ディレクトリ構成でソースを配置
- [ ] `slack create` 相当のスキャフォールド（`deno.jsonc` / `import_map.json` /
      `slack.json`）を整備、または既存 CLI 版からコピー
- [ ] `.gitignore` を Deno / Slack CLI 向けに補完（`.slack/`, `*.env`, ローカル
      生成物など）
- [ ] `assets/icon.png` を用意、または manifest の `icon` を調整
- [ ] `slack run` でローカル起動 → `slack trigger create` で Link トリガー生成
- [ ] フォームに Markdown テーブルを貼り、リッチなテーブルとして投稿されるか確認
- [ ] `chat:write.public` で未参加パブリックチャンネルへ投稿できるか確認
- [ ] （任意）Datastore への保存を確認、不要なら関連コードと scope を削除
- [ ] `slack deploy` で本番デプロイ

---

## 8. セットアップ／実行コマンド

```bash
# Slack CLI 未導入の場合
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash
slack login

# ローカル開発
slack run
slack trigger create --trigger-def triggers/post_markdown_table_trigger.ts

# 本番
slack deploy
slack trigger create --trigger-def triggers/post_markdown_table_trigger.ts
```

---

## 9. 入力例

```
| 銘柄コード | 会社名 | 開示種別 |
| --- | --- | --- |
| 7203 | トヨタ自動車 | 決算短信 |
| 6758 | ソニーグループ | 自己株式取得 |
```

---

## 10. 将来拡張

- **外部 Webhook トリガー版**: フォームを介さず JSON で Markdown を投入。フォームの
  文字数制限を回避でき、TDnet 通知のような自動連携に向く。
- **table / data_table ブロック版**: 列揃え・リンク・ソート等が必要になった場合。
- **GitHub Actions による CI/CD**: トークンを Secrets に登録し、push 契機で
  `slack deploy` を自動実行。認証情報をチャットに出さずに自動化できる。

---

## 参考（一次情報: docs.slack.dev）

- markdown ブロック: https://docs.slack.dev/reference/block-kit/blocks/markdown-block
- table ブロック: https://docs.slack.dev/reference/block-kit/blocks/table-block
- data table ブロック: https://docs.slack.dev/reference/block-kit/blocks/data-table-block
- フォーム作成: https://docs.slack.dev/tools/deno-slack-sdk/guides/creating-a-form/
- ワークフロー作成: https://docs.slack.dev/tools/deno-slack-sdk/guides/creating-workflows/
- API 呼び出し: https://docs.slack.dev/tools/deno-slack-sdk/guides/calling-slack-api-methods/
- トリガー: https://docs.slack.dev/tools/deno-slack-sdk/guides/using-triggers/
