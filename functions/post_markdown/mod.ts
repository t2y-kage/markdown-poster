import { SlackFunction } from "deno-slack-sdk/mod.ts";
import { PostMarkdownDefinition } from "./definition.ts";
import {
  buildMarkdownMessage,
  DELETE_ACTION_ID,
  EDIT_ACTION_ID,
} from "./blocks.ts";
import { parseThreadUrl } from "./thread_url.ts";
import { fetchLatestMarkdown, recordPost } from "./audit_log.ts";
import {
  downloadFileText,
  enforceLengthLimit,
  resolveSource,
} from "./file_source.ts";

// Slack の plain_text_input は max_length を 3,000 までしか許可しない
// （超えると views.open が invalid_arguments で失敗する）。このため編集モーダルで
// 扱える本文は 3,000 字までで、ファイル由来の長文（最大 12,000 字）はモーダルでは
// 編集できない。
const EDIT_MODAL_MAX_LEN = 3000;

const EDIT_MODAL_CALLBACK_ID = "edit_markdown_modal";
const MARKDOWN_INPUT_BLOCK_ID = "markdown_input_block";
const MARKDOWN_INPUT_ACTION_ID = "markdown_input";

// --- 投稿先決定 ---

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

// --- インタラクション payload 取り出し ---

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

// 編集・削除はどちらも「最初に投稿したユーザだけ」に許可する共通ガード。
// thread_url 経由で別チャンネルに投稿された可能性があるため、対象の channel/ts は
// inputs ではなく payload から取り出す。権限を満たさなければ ephemeral で通知し
// null を返す（呼び出し側は null なら中断する）。
async function resolveOwnedTarget(
  // deno-lint-ignore no-explicit-any
  body: any,
  inputs: { channel: string; submitted_by: string },
  // deno-lint-ignore no-explicit-any
  client: any,
): Promise<{ channel: string; ts: string } | null> {
  const channel = pickChannelFromBody(body, inputs.channel);
  const ts = pickMessageTsFromBody(body);
  if (!ts) return null;

  if (body.user.id !== inputs.submitted_by) {
    await client.chat.postEphemeral({
      channel,
      user: body.user.id,
      text: "この操作ができるのは、最初に投稿したユーザだけです。",
    });
    return null;
  }
  return { channel, ts };
}

// --- 編集モーダル ---

// posted_by は最初に投稿したユーザ。編集時も投稿者表示を保つため引き回す。
type EditMeta = { channel: string; ts: string; posted_by: string };

function parseEditMeta(raw: string | undefined): EditMeta | null {
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
          max_length: EDIT_MODAL_MAX_LEN,
        },
      },
    ],
  };
}

// --- SlackFunction 定義 ---

export default SlackFunction(
  PostMarkdownDefinition,
  async ({ inputs, client, token }) => {
    const { channel, markdown, file, submitted_by, thread_url } = inputs;

    // 直貼り / ファイル添付のどちらかから Markdown 本文を確定させる。
    // ここから先の経路は本文文字列のみに依存し、入力経路には依らない。
    const source = resolveSource({ markdown, file });
    if (source.kind === "error") return { error: source.message };

    let text: string;
    if (source.kind === "file") {
      const downloaded = await downloadFileText(client, token, source.fileId);
      if (!downloaded.ok) return { error: downloaded.message };
      text = downloaded.text;
    } else {
      text = source.markdown;
    }

    const limited = enforceLengthLimit(text);
    if (!limited.ok) return { error: limited.message };
    text = limited.text;

    const target = resolvePostTarget(channel, thread_url);
    if ("error" in target) return target;

    const response = await client.chat.postMessage({
      channel: target.channel,
      ...buildMarkdownMessage(text, submitted_by),
      ...(target.thread_ts ? { thread_ts: target.thread_ts } : {}),
    });

    if (!response.ok) {
      return {
        error: `chat.postMessage failed: ${response.error ?? "unknown error"}`,
      };
    }

    await recordPost(client, {
      channel: target.channel,
      markdown: text,
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
      const target = await resolveOwnedTarget(body, inputs, client);
      if (!target) return;
      const { channel, ts } = target;

      const currentMarkdown = await fetchLatestMarkdown(client, ts);

      // 編集モーダルの入力欄は 3,000 字までしか保持できない。これを超える本文
      // （ファイル由来の長文）はモーダルでは編集できないため、案内して中断する。
      if (currentMarkdown.length > EDIT_MODAL_MAX_LEN) {
        await client.chat.postEphemeral({
          channel,
          user: body.user.id,
          text:
            `この投稿は ${currentMarkdown.length} 字あり、編集モーダルの上限（${EDIT_MODAL_MAX_LEN} 字）を超えるため、その場では編集できません。修正版を Markdown ファイルとして貼り直してください。`,
        });
        return;
      }

      const view = await client.views.open({
        // Run on Slack では trigger_id ではなく interactivity_pointer を渡す
        trigger_id: body.interactivity.interactivity_pointer,
        view: buildEditModalView(
          { channel, ts, posted_by: inputs.submitted_by },
          currentMarkdown,
        ),
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
        ...buildMarkdownMessage(newMarkdown, meta.posted_by),
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
  )
  .addBlockActionsHandler(
    DELETE_ACTION_ID,
    async ({ body, inputs, client }) => {
      const target = await resolveOwnedTarget(body, inputs, client);
      if (!target) return;

      // bot が投稿したメッセージなので chat:write の範囲で削除できる。
      const deleted = await client.chat.delete({
        channel: target.channel,
        ts: target.ts,
      });
      await client.chat.postEphemeral({
        channel: target.channel,
        user: body.user.id,
        text: deleted.ok
          ? "メッセージを削除しました。"
          : `削除に失敗しました: ${deleted.error ?? "unknown error"}`,
      });
    },
  );
