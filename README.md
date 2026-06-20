# markdown-poster

Slack-hosted (Run on Slack / Deno Slack SDK) app that posts pasted Markdown
to a Slack channel as a rich message, using Block Kit's `markdown` block.
Markdown のテーブル記法もそのままレンダリングされます。

詳細な設計は [DESIGN.md](./DESIGN.md) を参照してください。

## 構成

```
manifest.ts                                # App マニフェスト
workflows/post_markdown.ts                 # フォーム入力 → 投稿
functions/post_markdown/
  definition.ts                            # 関数の入出力定義
  mod.ts                                   # SlackFunction + 各ハンドラ登録
  blocks.ts                                # メッセージ外枠（投稿者/ボタン/フォールバック）
  content_blocks.ts                        # 本文を markdown / table ブロックに変換
  markdown_table.ts                        # 本文を text/table セグメントに分割
  rich_text.ts                             # インライン Markdown → rich_text（セル装飾）
  file_source.ts                           # 直貼り/添付の解決・ファイル DL・長さガード
  interaction.ts                           # payload から channel/ts 取り出し・権限ガード
  edit_modal.ts                            # 編集モーダルの組み立て・入出力
  thread_url.ts                            # Slack メッセージ URL のパース
  audit_log.ts                             # Datastore 書き込み・読み出し
  client.ts                                # SlackAPIClient の最小別名
  *_test.ts                                # 純粋関数のユニットテスト
triggers/post_markdown_trigger.ts          # Link (Shortcut) トリガー
datastores/posted_messages.ts              # 監査ログ + 編集時の現在値ルックアップ
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
slack trigger create --trigger-def triggers/post_markdown_trigger.ts
```

表示された Shortcut URL
をチャンネルに貼るか、ブックマークするとフォームを起動できます。

## 本番デプロイ

```bash
slack deploy
slack trigger create --trigger-def triggers/post_markdown_trigger.ts
```

## 使い方

### 投稿

1. Shortcut URL（または「ワークフロー」メニュー）からワークフローを起動
2. 投稿先チャンネル、（任意で）スレッド対象メッセージの URL を入力し、本文は
   次のいずれか一方で渡して「Post」
   - **Markdown（直貼り）**: 短い本文を貼り付け（〜3,000 文字）
   - **Markdown ファイル（添付）**: 長文はテキストファイルを添付（〜12,000 文字）
3. レンダリングされた Markdown が投稿される（先頭に投稿者、末尾に「編集」「削除」
   ボタン付き）

直貼りとファイル添付は**どちらか一方**だけを使います（両方／両方空はエラー案内）。
投稿の先頭には `投稿者: @ユーザ` が表示されます。

入力例（テーブル記法もそのまま描画されます）:

```
| 商品 | カテゴリ | 価格 | 在庫 |
| --- | --- | --- | --- |
| ノート | 文具 | 200 | 50 |
| ボールペン | 文具 | 120 | 100 |
| マグカップ | 雑貨 | 800 | 30 |
| トートバッグ | 雑貨 | 1500 | 15 |
```

テーブルは `table` ブロックで描画され、**列ごとに折り返される**ため、セル内の
文字数が多くても横スクロールになりにくくなっています。セル内の Markdown 装飾
（**太字**・_斜体_・~~打消し~~・`コード`・リンク）も反映されます。

#### 長文（ファイル添付）について

OpenForm の文字列フィールドは約 3,000 文字が上限のため、それを超える Markdown は
テキストファイルとして添付します。関数が `files.info` → `url_private_download`
で本体を取得し、UTF-8 デコードした内容を `markdown` ブロック（上限 12,000 文字）
として投稿します。12,000 文字を超えるファイルは拒否されます。
（必要スコープ: `files:read` / outgoing domain: `files.slack.com`）

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

投稿された rich メッセージには「編集」ボタンが付きます。押すと現在の Markdown
が入った モーダルが開き、編集して「更新」すると `chat.update`
でその場で差し替わります。**編集は投稿者以外でも可能**で、投稿者と異なるユーザが
編集すると、先頭に `投稿者: @A` に加えて `編集者: @B` が併記されます。

編集モーダルの入力欄は Slack の制約で 3,000 文字までしか保持できません。そのため
**3,000 文字を超える投稿（ファイル添付由来の長文）には編集ボタンが表示されません**。
修正したい場合は新しいファイルで投稿し直し、古い投稿は「削除」してください。

### 削除

「削除」ボタンで投稿を取り消せます（確認ダイアログあり）。**削除できるのは最初に
投稿したユーザのみ**で、それ以外が押すと ephemeral メッセージで案内されます。
bot が投稿したメッセージのため `chat.delete`（`chat:write` の範囲）で消去します。

## 開発

リポジトリ直下で:

```bash
deno task test    # fmt --check + lint + test を一括実行
deno fmt          # 整形
deno lint         # 静的解析
deno test --allow-read --allow-net   # ユニットテスト
```

純粋関数には隣に `*_test.ts` を置く形を踏襲しています（`thread_url.ts` ↔
`thread_url_test.ts`、`blocks.ts` ↔ `blocks_test.ts`、`file_source.ts` /
`interaction.ts` / `edit_modal.ts` も同様）。新しい純粋関数を追加するときも
同じ形にしてください。

## 注意点

- アプリアイコンは `manifest.ts` の `icon`（必須）で `assets/icon.png` を参照します。
  好みの画像に差し替えてください。
- 技術的な制約（文字数・バイト長と `msg_too_long`・`markdown` ブロックの型・編集
  モーダルの上限・タイムアウトなど）は [DESIGN.md](./DESIGN.md) の
  「6. 制約・注意点」を参照してください。

## 監査ログ Datastore を使わない場合

Datastore は「監査ログ」と「編集時の現在 Markdown
ルックアップ」の両方を兼ねています。 完全に外す場合は
`datastores/posted_messages.ts` と `manifest.ts` の `datastores` / `datastore:*`
スコープを削除し、`functions/post_markdown/mod.ts` の
`client.apps.datastore.*`
呼び出しと、編集時の現在値ルックアップを削除してください。
削除すると編集モーダルが空で開くようになります。
