import { SlackFunction } from "deno-slack-sdk/mod.ts";
import { PostMarkdownTableDefinition } from "./definition.ts";
import {
  buildFallbackText,
  buildTableBlocks,
  EDIT_ACTION_ID,
} from "./blocks.ts";
import { parseThreadUrl } from "./thread_url.ts";
import { fetchLatestMarkdown, recordPost } from "./audit_log.ts";

const EDIT_MODAL_CALLBACK_ID = "edit_markdown_table_modal";
const MARKDOWN_INPUT_BLOCK_ID = "markdown_input_block";
const MARKDOWN_INPUT_ACTION_ID = "markdown_input";

// chat.postMessage / chat.update に渡すための blocks キャスト
// (deno-slack-sdk の型が markdown ブロックに未追随なため)
type ChatBlocksArg = Record<string, unknown>[];

// =============================================================================
// 投稿先決定
// =============================================================================

type PostTarget = { channel: string; thread_ts?: string };
type ResolveResult = PostTarget | { error: string };

function resolvePostTarget(
  channel: string,
  threadUrl: string | undefined,
): ResolveResult {
  if (!threadUrl || threadUrl.trim() === "") {
    return { channel };
  }
  const parsed = parseThreadUrl(threadUrl);
  if (!parsed) {
    return {
      error:
        "thread_url を解析できませんでした。Slack のメッセージ「リンクをコピー」で取得した URL を貼ってください。",
    };
  }
  return { channel: parsed.channel, thread_ts: parsed.thread_ts };
}

// =============================================================================
// インタラクション payload 取り出し
// =============================================================================

// block_actions payload は deno-slack-sdk の body 型に一部フィールドが現れないので、
// ここで構造アサーションを集約する。
type ActionBodyShape = {
  channel?: { id?: string };
  container?: { channel_id?: string; message_ts?: string };
  message?: { ts?: string };
};

function pickChannelFromBody(body: unknown, fallback: string): string {
  const b = body as ActionBodyShape;
  return b.channel?.id ?? b.container?.channel_id ?? fallback;
}

function pickMessageTsFromBody(body: unknown): string | undefined {
  const b = body as ActionBodyShape;
  return b.container?.message_ts ?? b.message?.ts;
}

// =============================================================================
// 編集モーダル
// =============================================================================

type EditMeta = { channel: string; ts: string };

function parseEditMeta(raw: string | undefined): EditMeta | null {
  try {
    const meta = JSON.parse(raw ?? "{}") as Partial<EditMeta>;
    if (typeof meta.channel === "string" && typeof meta.ts === "string") {
      return { channel: meta.channel, ts: meta.ts };
    }
  } catch { /* fall through */ }
  return null;
}

function inputErrorResponse(message: string) {
  return {
    response_action: "errors" as const,
    errors: { [MARKDOWN_INPUT_BLOCK_ID]: message },
  };
}

function buildEditModalView(meta: EditMeta, initialValue: string) {
  return {
    type: "modal",
    callback_id: EDIT_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify(meta),
    title: { type: "plain_text", text: "テーブルを編集" },
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
        },
      },
    ],
  };
}

// =============================================================================
// SlackFunction 定義
// =============================================================================

export default SlackFunction(
  PostMarkdownTableDefinition,
  async ({ inputs, client }) => {
    const { channel, markdown, submitted_by, thread_url } = inputs;

    const target = resolvePostTarget(channel, thread_url);
    if ("error" in target) return target;

    const response = await client.chat.postMessage({
      channel: target.channel,
      text: buildFallbackText(markdown),
      blocks: buildTableBlocks(markdown) as unknown as ChatBlocksArg,
      ...(target.thread_ts ? { thread_ts: target.thread_ts } : {}),
    });

    if (!response.ok) {
      return {
        error: `chat.postMessage failed: ${response.error ?? "unknown error"}`,
      };
    }

    await recordPost(client, {
      channel: target.channel,
      markdown,
      submitted_by,
      posted_ts: String(response.ts),
    });

    // 編集ボタンに継続応答するため、関数を完了させない
    return { completed: false };
  },
)
  .addBlockActionsHandler(
    EDIT_ACTION_ID,
    async ({ body, inputs, client }) => {
      // thread_url 経由で別チャンネルに投稿された可能性があるため、
      // 編集対象のチャンネル/ts は inputs ではなく payload から取り出す。
      const channel = pickChannelFromBody(body, inputs.channel);
      const ts = pickMessageTsFromBody(body);
      if (!ts) return;

      if (body.user.id !== inputs.submitted_by) {
        await client.chat.postEphemeral({
          channel,
          user: body.user.id,
          text: "この投稿を編集できるのは、最初に投稿したユーザだけです。",
        });
        return;
      }

      const currentMarkdown = await fetchLatestMarkdown(client, ts);

      const view = await client.views.open({
        // Run on Slack では trigger_id ではなく interactivity_pointer を渡す
        trigger_id: body.interactivity.interactivity_pointer,
        view: buildEditModalView({ channel, ts }, currentMarkdown),
      });

      if (!view.ok) {
        await client.chat.postEphemeral({
          channel,
          user: body.user.id,
          text: `編集モーダルを開けませんでした: ${
            view.error ?? "unknown error"
          }`,
        });
      }
    },
  )
  .addViewSubmissionHandler(
    EDIT_MODAL_CALLBACK_ID,
    async ({ body, view, client }) => {
      const meta = parseEditMeta(view.private_metadata);
      if (!meta) {
        return inputErrorResponse("メタデータの解析に失敗しました。");
      }

      const newMarkdown = view.state.values
        ?.[MARKDOWN_INPUT_BLOCK_ID]?.[MARKDOWN_INPUT_ACTION_ID]?.value ?? "";
      if (newMarkdown.trim() === "") {
        return inputErrorResponse("Markdown を入力してください。");
      }

      const updated = await client.chat.update({
        channel: meta.channel,
        ts: meta.ts,
        text: buildFallbackText(newMarkdown),
        blocks: buildTableBlocks(newMarkdown) as unknown as ChatBlocksArg,
      });

      if (!updated.ok) {
        return inputErrorResponse(
          `更新に失敗しました: ${updated.error ?? "unknown error"}`,
        );
      }

      await recordPost(client, {
        channel: meta.channel,
        markdown: newMarkdown,
        submitted_by: body.user.id,
        posted_ts: meta.ts,
      });

      // 何も返さなければ Slack 側でモーダルが閉じる。関数は引き続き開いておく。
    },
  );
