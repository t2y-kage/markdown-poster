# markdown-table-poster

Slack-hosted (Run on Slack / Deno Slack SDK) app that posts a pasted Markdown
table to a Slack channel as a rich table, using Block Kit's `markdown` block.

詳細な設計は [DESIGN.md](./DESIGN.md) を参照してください。

## 構成

```
manifest.ts                                # App マニフェスト
workflows/post_markdown_table.ts           # フォーム入力 → 投稿
functions/post_markdown_table/
  definition.ts                            # 関数の入出力定義
  mod.ts                                   # SlackFunction + 編集ハンドラ登録
  blocks.ts                                # Block Kit ペイロード組み立て
  thread_url.ts                            # Slack メッセージ URL のパース
  audit_log.ts                             # Datastore 書き込み・読み出し
  thread_url_test.ts                       # parseThreadUrl のユニットテスト
triggers/post_markdown_table_trigger.ts    # Link (Shortcut) トリガー
datastores/posted_tables.ts                # 監査ログ + 編集時の現在値ルックアップ
deno.jsonc / import_map.json / .slack/hooks.json
```

## 前提

- [Slack CLI](https://docs.slack.dev/tools/slack-cli/) と
  [Deno](https://deno.com/) がインストール済み
- ワークスペースで Run on Slack アプリの開発が許可されている

```bash
# Slack CLI
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash
slack login

# Deno（Slack CLI がフックスクリプトを deno run で起動するため必須）
curl -fsSL https://deno.land/install.sh | sh
# シェル再起動後 `deno --version` で確認
```

## ローカル開発

```bash
slack run
slack trigger create --trigger-def triggers/post_markdown_table_trigger.ts
```

表示された Shortcut URL
をチャンネルに貼るか、ブックマークするとフォームを起動できます。

## 本番デプロイ

```bash
slack deploy
slack trigger create --trigger-def triggers/post_markdown_table_trigger.ts
```

## 使い方

### 投稿

1. Shortcut URL（または「ワークフロー」メニュー）からワークフローを起動
2. 投稿先チャンネル、（任意で）スレッド対象メッセージの URL、Markdown
   テーブルを入力して「Post」
3. レンダリングされたテーブルが投稿される（末尾に「編集」ボタン付き）

入力例:

```
| 銘柄コード | 会社名 | 開示種別 |
| --- | --- | --- |
| 7203 | トヨタ自動車 | 決算短信 |
| 6758 | ソニーグループ | 自己株式取得 |
```

### スレッド返信として投稿する

フォームの **Thread URL (optional)**
欄に、返信したいメッセージの「リンクをコピー」で 取得した URL
を貼ります。`?thread_ts=` 付きのリプライ URL でも親 ts を自動抽出します。
投稿先チャンネルも URL から自動補正されます。空欄ならトップレベル投稿です。

> 補足: Slack のメッセージ「︙
> もっと見る」メニューから直接ワークフローを起動する UX は Run on Slack
> のコード型 Link Trigger では現状サポートされていないため、
> スレッド返信したい場合は対象メッセージのリンクをコピーしてフォームに貼り付ける
> 運用になります。

### 編集

投稿された rich テーブルには「編集」ボタンが付きます。押すと現在の Markdown
が入った モーダルが開き、編集して「更新」すると `chat.update`
でその場で差し替わります。
**編集権限は最初に投稿したユーザのみ**で、それ以外がボタンを押すと ephemeral
メッセージで 案内されます。

## 開発

リポジトリ直下で:

```bash
deno task test    # fmt --check + lint + test を一括実行
deno fmt          # 整形
deno lint         # 静的解析
deno test --allow-read --allow-net   # ユニットテスト
```

`functions/post_markdown_table/thread_url_test.ts` で `parseThreadUrl`
のユニットテストを定義しています。新しい純粋関数を追加するときは隣に `*_test.ts`
を置く形を踏襲してください。

## 注意点

- `markdown` ブロックの型が `deno-slack-sdk` に未追随のため、`blocks`
  をキャストしています。
- OpenForm の文字列フィールドはおおむね 3,000
  文字が上限です。これより大きなテーブルを 扱う場合は将来的に Webhook
  トリガー版の追加を検討してください。
- 編集ボタンに継続応答するため、`post_markdown_table` 関数は `completed: false`
  で 開いたままになります。Slack-hosted の関数は実行ごとに 60
  秒の制約がありますが、 ハンドラ単位の制限のため通常運用上は問題ありません。
- アプリアイコンは任意です。設定する場合は `assets/icon.png` を配置し、
  `manifest.ts` に `icon: "assets/icon.png"` を追加してください（既定では未設定）。

## 監査ログ Datastore を使わない場合

Datastore は「監査ログ」と「編集時の現在 Markdown
ルックアップ」の両方を兼ねています。 完全に外す場合は
`datastores/posted_tables.ts` と `manifest.ts` の `datastores` / `datastore:*`
スコープを削除し、`functions/post_markdown_table/mod.ts` の
`client.apps.datastore.*`
呼び出しと、編集時の現在値ルックアップを削除してください。
削除すると編集モーダルが空で開くようになります。
