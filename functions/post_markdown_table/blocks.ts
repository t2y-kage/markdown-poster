// Block Kit ペイロード組み立てヘルパ。
// markdown ブロック + 「編集」ボタンの actions ブロックを返す。

export const EDIT_ACTION_ID = "edit_markdown_table";
const EDIT_BLOCK_ID = "edit_actions";

// text は通知・検索用のフォールバック。保守的な上限で切り詰める。
const FALLBACK_MAX_LEN = 3000;

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

// chat.postMessage / chat.update に渡す { text, blocks }。
// deno-slack-sdk の型が markdown ブロックに未追随なため、キャストはここに閉じ込める。
export function buildTableMessage(
  markdown: string,
): { text: string; blocks: Record<string, unknown>[] } {
  return {
    text: buildFallbackText(markdown),
    blocks: buildTableBlocks(markdown) as unknown as Record<string, unknown>[],
  };
}
