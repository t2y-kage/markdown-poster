// Block Kit ペイロード組み立てヘルパ。
// markdown ブロック + 「編集」ボタンの actions ブロックを返す。

export const EDIT_ACTION_ID = "edit_markdown";
export const DELETE_ACTION_ID = "delete_markdown";
const EDIT_BLOCK_ID = "edit_actions";

// text は通知・検索用のフォールバック。保守的な上限で切り詰める。
const FALLBACK_MAX_LEN = 3000;

export type Block = { type: string; [key: string]: unknown };

export function buildMarkdownBlocks(
  markdown: string,
  postedBy?: string,
  editedBy?: string,
): Block[] {
  const blocks: Block[] = [];
  // 誰が投稿したか分かるよう、本文の前に投稿者を表示する。mrkdwn の <@U…> は
  // メンションとして確実にレンダリングされる（markdown ブロックの挙動に依らない）。
  // 投稿者と異なるユーザが編集した場合は編集者も併記する。
  if (postedBy) {
    let info = `投稿者: <@${postedBy}>`;
    if (editedBy && editedBy !== postedBy) {
      info += `\n編集者: <@${editedBy}>`;
    }
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: info }],
    });
  }
  blocks.push({ type: "markdown", text: markdown });
  blocks.push({
    type: "actions",
    block_id: EDIT_BLOCK_ID,
    elements: [
      {
        type: "button",
        action_id: EDIT_ACTION_ID,
        text: { type: "plain_text", text: "編集" },
      },
      {
        type: "button",
        action_id: DELETE_ACTION_ID,
        style: "danger",
        text: { type: "plain_text", text: "削除" },
        // 誤クリック防止に確認ダイアログを挟む。削除は元に戻せない。
        confirm: {
          title: { type: "plain_text", text: "メッセージを削除" },
          text: {
            type: "plain_text",
            text: "この投稿を削除します。元に戻せません。",
          },
          confirm: { type: "plain_text", text: "削除" },
          deny: { type: "plain_text", text: "キャンセル" },
          style: "danger",
        },
      },
    ],
  });
  return blocks;
}

export function buildFallbackText(markdown: string): string {
  if (markdown.length < FALLBACK_MAX_LEN) return markdown;
  return `${markdown.slice(0, FALLBACK_MAX_LEN - 1)}…`;
}

// chat.postMessage / chat.update に渡す { text, blocks }。
// deno-slack-sdk の型が markdown ブロックに未追随なため、キャストはここに閉じ込める。
export function buildMarkdownMessage(
  markdown: string,
  postedBy?: string,
  editedBy?: string,
): { text: string; blocks: Record<string, unknown>[] } {
  return {
    text: buildFallbackText(markdown),
    blocks: buildMarkdownBlocks(
      markdown,
      postedBy,
      editedBy,
    ) as unknown as Record<string, unknown>[],
  };
}
