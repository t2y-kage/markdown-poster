// 「編集」モーダル関連: ビュー組み立て・private_metadata の入出力・入力値の取り出し。

import { EDITABLE_MAX_LEN } from "./blocks.ts";

export const EDIT_MODAL_CALLBACK_ID = "edit_markdown_modal";
const MARKDOWN_INPUT_BLOCK_ID = "markdown_input_block";
const MARKDOWN_INPUT_ACTION_ID = "markdown_input";

// posted_by は最初に投稿したユーザ。編集時も投稿者表示を保つため引き回す。
export type EditMeta = { channel: string; ts: string; posted_by: string };

export function parseEditMeta(raw: string | undefined): EditMeta | null {
  try {
    const meta = JSON.parse(raw ?? "{}") as Partial<EditMeta>;
    if (
      typeof meta.channel === "string" && typeof meta.ts === "string" &&
      typeof meta.posted_by === "string"
    ) {
      return { channel: meta.channel, ts: meta.ts, posted_by: meta.posted_by };
    }
  } catch { /* fall through */ }
  return null;
}

// view submission payload から編集後の Markdown を取り出す。
type ViewState = {
  state?: {
    values?: Record<string, Record<string, { value?: string }>>;
  };
};

export function readMarkdownInput(view: ViewState): string {
  return view.state?.values?.[MARKDOWN_INPUT_BLOCK_ID]
    ?.[MARKDOWN_INPUT_ACTION_ID]?.value ?? "";
}

// view submission のバリデーションエラー応答（入力欄の下にメッセージを表示）。
export function inputErrorResponse(message: string) {
  return {
    response_action: "errors" as const,
    errors: { [MARKDOWN_INPUT_BLOCK_ID]: message },
  };
}

export function buildEditModalView(meta: EditMeta, initialValue: string) {
  return {
    type: "modal",
    callback_id: EDIT_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify(meta),
    title: { type: "plain_text", text: "Markdown を編集" },
    submit: { type: "plain_text", text: "更新" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks: [
      {
        type: "input",
        block_id: MARKDOWN_INPUT_BLOCK_ID,
        label: { type: "plain_text", text: "Markdown" },
        element: {
          type: "plain_text_input",
          action_id: MARKDOWN_INPUT_ACTION_ID,
          multiline: true,
          initial_value: initialValue,
          // plain_text_input の max_length は 3,000 が上限（Slack の制約）。
          max_length: EDITABLE_MAX_LEN,
        },
      },
    ],
  };
}
