# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際のガイドです。

## 概要

`markdown-poster` は Slack-hosted（Run on Slack / Deno Slack SDK）で動作する Slack
アプリ。フォームに貼り付けた Markdown を、Block Kit の `markdown` ブロックで
レンダリングされた表示として投稿する。投稿後はその場で編集もできる。

外部サーバを持たず Slack のマネージドインフラ上で完結させ、ランニングコストを
ゼロにする方針。詳細は [DESIGN.md](./DESIGN.md)、使い方は [README.md](./README.md)
を参照。

> 注: 名称は `markdown-table-poster` から `markdown-poster` に変更済み。機能は
> Markdown テーブルに限らず Markdown 全般を投稿できる。これに伴い `post_markdown_table`
> 系の識別子・ファイル名・Datastore (`posted_tables` → `posted_messages`) も
> table 非依存の名前へリネーム済み（互換性は意図的に破棄）。

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
  mod.ts          # SlackFunction 本体 + 「編集」ボタンのハンドラ登録
  blocks.ts       # Block Kit ペイロード組み立て（markdown ブロック）
  thread_url.ts   # Slack メッセージ URL → channel/ts のパース
  audit_log.ts    # Datastore への書き込み・読み出し
  *_test.ts       # 純粋関数のユニットテスト
datastores/posted_messages.ts      # 監査ログ + 編集時の現在値ルックアップ
```

要点:

- 投稿は組み込み `SendMessage` ではなく**カスタム関数経由**。`markdown` ブロックを
  渡すため `client.chat.postMessage` を直接呼ぶ。
- OpenForm を使うため Workflow には `interactivity` 入力が必須。OpenForm は最初の
  ステップに置く。
- 編集ボタンに継続応答するため、関数は `completed: false` で開いたままにする。
- 編集は誰でも可能（投稿者と異なる編集者はメッセージに併記される）。削除は最初に
  投稿したユーザのみ。

## コード規約

- 新しい純粋関数を追加するときは、隣に `*_test.ts` を置く形を踏襲する
  （例: `thread_url.ts` ↔ `thread_url_test.ts`）。
- 変更後は必ず `deno task test` を通す。
- `markdown` ブロックの型が `deno-slack-sdk` に未追随のため `blocks` をキャスト
  している箇所がある（`blocks.ts` 参照）。

## 注意点

- OpenForm の文字列フィールドはおおむね 3,000 文字が上限。
- Datastore は監査ログと編集時の現在値ルックアップを兼ねる。外す場合の手順は
  README の「監査ログ Datastore を使わない場合」を参照。
