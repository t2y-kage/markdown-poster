# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際のガイドです。

## 概要

`markdown-poster` は Slack-hosted（Run on Slack / Deno Slack SDK）で動作する Slack アプリ。
フォームに貼り付けた Markdown を、Block Kit の `markdown` ブロックでレンダリングされた表示として投稿する。
投稿後はその場で編集もできる。

外部サーバを持たず Slack のマネージドインフラ上で完結させ、ランニングコストをゼロにする方針。
詳細は [DESIGN.md](./DESIGN.md)、使い方は [README.md](./README.md) を参照。

> 注: 名称は `markdown-table-poster` から `markdown-poster` に変更済み。
> 機能は Markdown テーブルに限らず Markdown 全般を投稿できる。
> これに伴い `post_markdown_table` 系の識別子、ファイル名、Datastore (`posted_tables` → `posted_messages`) も table 非依存の名前へリネーム済み（互換性は意図的に破棄）。

## 開発コマンド

```bash
deno task test    # fmt --check + lint + check + test を一括実行（CI 相当）
deno fmt          # 整形
deno lint         # 静的解析
deno test --allow-read --allow-net   # ユニットテスト
```

Slack CLI（要ローカルインストール、`slack login` 済み）:

```bash
slack run                                                          # ローカル起動
slack deploy                                                       # 本番デプロイ
slack trigger create --trigger-def triggers/post_markdown_trigger.ts
```

## アーキテクチャ

Run on Slack の 3 要素で構成: **Trigger → Workflow → Function**。

```
manifest.ts                        # App マニフェスト（name/scopes/登録）
triggers/post_markdown_trigger.ts  # Link(Shortcut) トリガー
workflows/post_markdown.ts         # OpenForm → カスタム関数 の 2 ステップ
functions/post_markdown/
  definition.ts   # 関数の入出力定義
  mod.ts          # SlackFunction 本体 + 各ハンドラの登録（オーケストレーション）
  blocks.ts       # メッセージ外枠（投稿者 context / 編集・削除ボタン / フォールバック）
  content_blocks.ts # 本文を markdown / table ブロックに変換
  markdown_table.ts # 本文を text/table セグメントに分割（GFM テーブル検出）
  rich_text.ts    # インライン Markdown → rich_text（テーブルのセル装飾）
  file_source.ts  # 入力経路の XOR 解決 + 添付ファイルの DL/デコード + 長さガード
  interaction.ts  # block_actions payload から channel/ts を取り出す + 権限ガード
  edit_modal.ts   # 編集モーダルの組み立て・private_metadata 入出力・入力値取り出し
  thread_url.ts   # Slack メッセージ URL → channel/ts のパース
  audit_log.ts    # Datastore への書き込み・読み出し
  client.ts       # SlackAPIClient の最小別名（ヘルパ間で共有）
  *_test.ts       # 純粋関数のユニットテスト
datastores/posted_messages.ts      # 監査ログ + 編集時の現在値ルックアップ
```

要点:

- 投稿は組み込み `SendMessage` ではなくカスタム関数経由で行う。`markdown` ブロックを渡すため `client.chat.postMessage` を直接呼ぶ。
- 本文中の GFM テーブルは `markdown` ブロックでは列を折り返せず横スクロールになるため、`markdown_table.ts` で検出して `table` ブロック（全列 `is_wrapped`）で描画する。テキスト部分は従来どおり `markdown` ブロック。生の Markdown を保存と編集の正とし、描画時にパースする。セル内の装飾（太字、斜体、打消し、コード、リンク）は `rich_text.ts` で `rich_text` セルに変換して反映する。
- OpenForm を使うため Workflow には `interactivity` 入力が必須。OpenForm は最初のステップに置く。
- 編集ボタンに継続応答するため、関数は `completed: false` で開いたままにする。
- 編集は誰でも可能（投稿者と異なる編集者はメッセージに併記される）。削除は最初に投稿したユーザのみ。
- 入力経路は直貼り（〜3,000字）か添付ファイル（〜12,000字）の XOR。`mod.ts` 冒頭の `resolveSource` で本文文字列を確定させ、以降は経路に依らず共通。
- 添付ファイルは `files.info` → `url_private_download` を bot token 付きで fetch し UTF-8 デコードする（`files:read` スコープ + `files.slack.com` の outgoing domain が必要）。

## コード規約

- 新しい純粋関数を追加するときは、隣に `*_test.ts` を置く形を踏襲する（例: `thread_url.ts` ↔ `thread_url_test.ts`）。
- 変更後は必ず `deno task test` を通す。
- `markdown` ブロックの型が `deno-slack-sdk` に未追随のため `blocks` をキャストしている箇所がある（`blocks.ts` 参照）。

## 注意点

- OpenForm の文字列フィールド（直貼り）はおおむね 3,000 文字が上限。これを超える長文はテキストファイルを添付し、`markdown` ブロックの上限 12,000 文字まで扱う。
- 編集モーダルの `plain_text_input` は `max_length` が 3,000 まで（Slack の制約）。そのため 3,000 字超の投稿は編集ボタンを出さず、その場では編集不可（再投稿で対応）。
- Slack は `markdown` ブロックをサーバ側で展開する。見出しと区切り線はそれぞれ 1 ブロック、その間の連続する本文はまとめて 1 ブロック、テーブルは 1 個 1 ブロック。展開後の合計が 50 を超えると `invalid_blocks` になる。送信するブロック数が 20 個程度でも起こるため、`block_budget.ts` の `checkBlockBudget` で投稿前に見積もって弾く。本文の長さではなく見出し・区切り線・テーブルの数が効く。
- 送信長エラー `msg_too_long` はバイト長で判定される。本文を通知用 `text` フォールバックに丸ごと積むと多バイト文字で容易に超過するため、`blocks.ts` の `buildFallbackText` はバイト長で短く切り詰めている。
- Datastore は監査ログと編集時の現在値ルックアップを兼ねる。外す場合の手順は README の「監査ログ Datastore を使わない場合」を参照。
