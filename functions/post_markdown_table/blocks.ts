// Block Kit ペイロード組み立てヘルパ。
// markdown ブロック + 「編集」ボタンの actions ブロックを返す。

export const EDIT_ACTION_ID = "edit_markdown_table";
const EDIT_BLOCK_ID = "edit_actions";

// chat.postMessage の text フィールド（通知や検索用フォールバック）の上限。
// 末尾を "…" に置き換える分の余白を 1 文字残す。
const FALLBACK_MAX_LEN = 3000;

// deno-slack-sdk の型に markdown ブロックが未追随なので、
// chat.postMessage / chat.update に渡す際は呼び出し側でキャストする。
export type Block = { type: string; [key: string]: unknown };

export function buildTableBlocks(markdown: string): Block[] {
  return [
    { type: "markdown", text: markdown },
    {
      type: "actions",
      block_id: EDIT_BLOCK_ID,
      elements: [
        {
          type: "button",
          action_id: EDIT_ACTION_ID,
          text: { type: "plain_text", text: "編集" },
        },
      ],
    },
  ];
}

export function buildFallbackText(markdown: string): string {
  if (markdown.length < FALLBACK_MAX_LEN) return markdown;
  return `${markdown.slice(0, FALLBACK_MAX_LEN - 1)}…`;
}
