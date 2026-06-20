# markdown-poster 設計仕様

Slack-hosted（Run on Slack / Deno Slack SDK）で動作する、Markdown を
リッチなメッセージとして投稿する Slack アプリの設計仕様。テーブル記法も
そのまま描画されます。

リポジトリ: https://github.com/t2y-kage/markdown-poster

---

## 1. 目的と方針

- フォームに貼り付けた **Markdown** を、Slack 上でレンダリングされた
  リッチなメッセージとして投稿する（テーブル記法を含む）。
- **運用・保守コストを最小化**する。外部サーバーを持たず、Slack 社のマネージド
  インフラ（Run on Slack）上で完結させ、ランニングコストをゼロにする。
- 認証情報をチャット等に露出させない。コミット／デプロイは開発者のローカル環境
  または GitHub Actions（Secrets 経由）から行う。

---

## 2. 採用アプローチ（方式A: markdown ブロック）

Block Kit の `markdown` ブロックは標準的な Markdown を渡すと Slack 側でレンダリング
する。サポート記法に**テーブルが含まれており**、`| 見出し | ... | / | --- | ... |`
形式がフォーマット済みテーブルとして描画される。

→ 基本は、フォームで受け取った Markdown 文字列を**パースせずそのまま** `markdown`
ブロックの `text` に渡して `chat.postMessage` するだけ。最小コード・最小保守。

ただし `markdown` ブロックは**テーブルの列幅・折り返しを制御できず**、長文セルが
あると横に伸びて横スクロールになる。そこで本文中の GFM テーブルだけは検出して
**`table` ブロック（列ごとに `is_wrapped` で折り返し）**で描画する（`markdown_table.ts`
／`blocks.ts`）。テーブル以外のテキストは引き続き `markdown` ブロック。生の
Markdown は保存・編集の正のまま、描画時にパースする。`table` ブロックのセルは
プレーンテキスト（`raw_text`）扱いで、セル内の Markdown 装飾は反映されない。

参照:

- markdown ブロック: https://docs.slack.dev/reference/block-kit/blocks/markdown-block
- table ブロック: https://docs.slack.dev/reference/block-kit/blocks/table-block

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
         ├─ Step1: OpenForm        … channel / markdown(直貼り) / file(添付) / thread_url
         └─ Step2: Custom Function
              ├─ resolveSource: 直貼り or 添付ファイル → Markdown 本文を確定
              ├─ ファイルなら files.info→DL→UTF-8 デコード、12,000 字ガード
              └─ markdown ブロックで chat.postMessage（任意で Datastore 保存）
                   投稿後: 編集（誰でも可）/ 削除（投稿者のみ）に継続応答
```

設計上の要点:

- 投稿は組み込み `SendMessage` ではなく**カスタムファンクション経由**で行う。
  `SendMessage` は任意の `blocks` を渡せないため、`markdown` ブロックを使うには
  カスタムファンクションから `client.chat.postMessage` を直接呼ぶ必要がある。
- OpenForm を使うため Workflow には `interactivity` 入力が必須。フォームが意図せず
  開くのを防ぐ仕組みで、OpenForm は最初のステップに置く。
- 起動チャンネルを投稿先の既定値としてトリガーから渡す。
- **入力経路は直貼りと添付ファイルの XOR**。分岐は「Markdown 文字列を得る」冒頭の
  `resolveSource` だけに閉じ込め、以降の経路（ブロック組み立て・投稿・編集・削除・
  Datastore 保存）は本文文字列のみに依存し、入力経路には依らない。

参照:

- フォーム作成: https://docs.slack.dev/tools/deno-slack-sdk/guides/creating-a-form/
- API 呼び出し: https://docs.slack.dev/tools/deno-slack-sdk/guides/calling-slack-api-methods/
- トリガー: https://docs.slack.dev/tools/deno-slack-sdk/guides/using-triggers/

---

## 4. コンポーネント仕様

### manifest.ts

- workflows / functions / datastores を登録。
- botScopes:
  - `chat:write` … メッセージ投稿・編集・削除
  - `chat:write.public` … 未参加のパブリックチャンネルへも投稿可能にする
  - `datastore:read` / `datastore:write` … 監査ログ用（任意機能。不要なら削除）
  - `files:read` … フォームに添付されたファイル本体の読み取り
- outgoingDomains: `files.slack.com`（`url_private_download` の fetch に必要）

### triggers/post_markdown_trigger.ts

- `TriggerTypes.Shortcut`（Link トリガー）。
- 生成された Shortcut URL をチャンネルに貼る／ブックマークして起動。
- inputs: `interactivity`, `channel`(= 起動チャンネル) を Workflow に渡す。

### workflows/post_markdown.ts

- input_parameters: `interactivity`(必須), `channel`(任意)。
- Step1 `Schema.slack.functions.OpenForm`（`required` は `channel` のみ。
  markdown / file は関数内で XOR 検証するため任意）:
  - `channel`: channel_id（既定値 = トリガーの channel）
  - `markdown`: string, `long: true`, `maxLength: 3000`（直貼り）
  - `file`: array of `file_id`, `maxItems: 1`（テキストファイル添付）
  - `thread_url`: string（任意）
- Step2 カスタムファンクション: `channel`, `markdown`, `file`, `thread_url`,
  `submitted_by` を渡す。

### functions/post_markdown/definition.ts

- inputs: `channel`(channel_id), `markdown`(string), `file`(array of file_id),
  `submitted_by`(user_id), `thread_url`(string)。`markdown` と `file` は排他のため
  `required` には入れない。

### functions/post_markdown/mod.ts ほか

- `mod.ts` はオーケストレーションに専念。`resolveSource`（`file_source.ts`）で
  本文を確定し、`client.chat.postMessage` に `markdown` ブロック + 投稿者 context
  ブロック + 編集/削除ボタンを渡す。投稿成功後、任意で Datastore に監査ログを put
  （失敗してもログのみで投稿成否に影響させない）。
- ヘルパは関心事ごとに分割: `file_source.ts`（入力経路の解決・DL・長さガード）、
  `interaction.ts`（payload 取り出し・権限ガード）、`edit_modal.ts`（編集モーダル）、
  `blocks.ts`（ペイロード組み立て）、`client.ts`（SlackAPIClient の最小別名）。
- 通知用フォールバック `text` は**バイト長**で短く切り詰める（`buildFallbackText`）。
  本文を丸ごと積むと多バイト文字で `msg_too_long` を誘発するため。

### 投稿後の操作（編集・削除・投稿者表示）

- 投稿の先頭に `投稿者: @user` を context ブロックで表示。別ユーザが編集した場合は
  `編集者: @user` を併記（元投稿者は private_metadata で引き回し不変に保つ）。
- **編集は誰でも可**、**削除は最初に投稿したユーザのみ**。
- 編集モーダルの `plain_text_input` は `max_length` 3,000 が上限（Slack 制約）。
  3,000 字超の投稿には編集ボタンを出さず、その場では編集不可（再投稿で対応）。

### datastores/posted_messages.ts（任意）

- primary_key: `id`
- attributes: `id`, `channel`, `markdown`, `submitted_by`, `posted_ts`, `created_at`
- 監査ログ／将来の重複防止・レビュー用途。不要なら manifest から外す。

---

## 5. プロジェクト構成

ファイル一覧と各ファイルの役割は README の「構成」を参照。各コンポーネントの
詳細仕様は本書「4. コンポーネント仕様」を参照。`deno.jsonc` / `import_map.json` /
`slack.json` は Slack CLI のスキャフォールドが生成する設定ファイル。

---

## 6. 制約・注意点

- **markdown ブロックの型**: `deno-slack-sdk` の型定義が `markdown` ブロックに
  未追随の場合、`type: "markdown"` で型エラーになり得る。回避策は (a) blocks を
  キャスト、または (b) `client.apiCall("chat.postMessage", {...})` を使う。
- **文字数上限の不一致**: OpenForm の文字列フィールド（直貼り）はおおむね 3,000
  文字が上限。一方 `markdown` ブロックは 1 ペイロード合計 12,000 文字まで。両者の
  差は**テキストファイル添付**で埋める（添付経路は 12,000 文字まで、超過は拒否）。
- **編集モーダルの上限**: `plain_text_input` の `max_length` は 3,000 が上限
  （超えると `views.open` が `invalid_arguments`）。3,000 字超の投稿は編集不可。
- **table ブロックの上限**: 1 テーブルあたり全セル合計 10,000 文字、最大 100 行 ×
  20 列。セルはプレーンテキスト（`raw_text`）で Markdown 装飾は反映されない。
- **バイト長と `msg_too_long`**: 送信長制限はバイト長で判定される。多バイト文字
  （日本語など）は 1 文字 ≈ 3 バイトで、文字数の見た目より早く上限に当たる。通知用
  `text` フォールバックはバイト長で切り詰める。
- **タイムアウト**: デプロイ済みファンクションは 60 秒、View インタラクションは 10 秒。
- **関数の継続実行**: 編集・削除ボタンに応答し続けるため `post_markdown` は
  `completed: false` で開いたままにする（ハンドラ単位の 60 秒制約のため通常運用上は
  問題ない）。
- **レンダリング確認**: `markdown` ブロックのテーブル描画は対象クライアント／
  ワークスペースで実機確認する。
- **実行環境**: `slack run` / `slack deploy` はローカルの Slack CLI から行う。

---

## 7. 実装タスク（Claude Code 用チェックリスト）

- [ ] 既存リポジトリに README の「構成」のディレクトリ構成でソースを配置
- [ ] `slack create` 相当のスキャフォールド（`deno.jsonc` / `import_map.json` /
      `slack.json`）を整備、または既存 CLI 版からコピー
- [ ] `.gitignore` を Deno / Slack CLI 向けに補完（`.slack/`, `*.env`, ローカル
      生成物など）
- [ ] `assets/icon.png` を用意、または manifest の `icon` を調整
- [ ] `slack run` でローカル起動 → `slack trigger create` で Link トリガー生成
- [ ] フォームに Markdown（テーブル記法を含む）を貼り、リッチに投稿されるか確認
- [ ] `chat:write.public` で未参加パブリックチャンネルへ投稿できるか確認
- [ ] （任意）Datastore への保存を確認、不要なら関連コードと scope を削除
- [ ] `slack deploy` で本番デプロイ

---

## 8. 将来拡張

- **外部 Webhook トリガー版**: フォームを介さず JSON で Markdown を投入。TDnet 通知
  のような自動連携（人手 UX 不要なケース）に向く。なお直貼りの文字数制限は
  ファイル添付で回避済みのため、Webhook はあくまで自動連携用途として位置づける。
- **table ブロックのセル装飾 / data_table ブロック**: 現状テーブルは折り返しのため
  `table` ブロックで描画しているが、セルはプレーンテキスト。セル内の Markdown 装飾
  （リンク・強調）を反映するなら `rich_text` セル化、ソート/フィルタ等が必要なら
  `data_table` ブロックを検討。
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
