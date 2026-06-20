// Block Kit ペイロード組み立てヘルパ。
// markdown ブロック + 「編集」ボタンの actions ブロックを返す。

export const EDIT_ACTION_ID = "edit_markdown";
export const DELETE_ACTION_ID = "delete_markdown";
const EDIT_BLOCK_ID = "edit_actions";

// text は通知・検索用のフォールバック。本文は markdown ブロックが持つので、
// ここは短くてよい。多バイト文字（日本語など）は 1 文字が複数バイトになり、
// 文字数ではなくバイト長で Slack の送信上限（msg_too_long）に当たるため、
// 文字数ではなくバイト長で控えめに切り詰める。
export const FALLBACK_MAX_BYTES = 2000;

// 編集モーダルの入力欄（plain_text_input）は 3,000 字までしか保持できない
// （Slack の制約）。これを超える本文は編集できないため、編集ボタン自体を出さない。
export const EDITABLE_MAX_LEN = 3000;

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
  // 3,000 字を超える本文は編集モーダルで扱えないため、編集ボタンを出さない。
  const elements: Block[] = [];
  if (markdown.length <= EDITABLE_MAX_LEN) {
    elements.push({
      type: "button",
      action_id: EDIT_ACTION_ID,
      text: { type: "plain_text", text: "編集" },
    });
  }
  elements.push({
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
  });
  blocks.push({ type: "actions", block_id: EDIT_BLOCK_ID, elements });
  return blocks;
}

export function buildFallbackText(markdown: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(markdown).length <= FALLBACK_MAX_BYTES) return markdown;

  // バイト予算に収まるまで 1 文字（コードポイント）ずつ積む。多バイト文字の
  // 途中で切らないよう for...of で反復する。末尾の「…」分のバイトを残しておく。
  const ellipsis = "…";
  const budget = FALLBACK_MAX_BYTES - encoder.encode(ellipsis).length;
  let bytes = 0;
  let out = "";
  for (const ch of markdown) {
    const n = encoder.encode(ch).length;
    if (bytes + n > budget) break;
    out += ch;
    bytes += n;
  }
  return out + ellipsis;
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
