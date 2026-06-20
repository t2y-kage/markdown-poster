import { SlackFunction } from "deno-slack-sdk/mod.ts";
import { PostMarkdownDefinition } from "./definition.ts";
import {
  buildMarkdownMessage,
  DELETE_ACTION_ID,
  EDIT_ACTION_ID,
  EDITABLE_MAX_LEN,
} from "./blocks.ts";
import { parseThreadUrl } from "./thread_url.ts";
import { fetchLatestMarkdown, recordPost } from "./audit_log.ts";
import {
  downloadFileText,
  enforceLengthLimit,
  resolveSource,
} from "./file_source.ts";

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

// 操作対象メッセージの channel/ts を payload から取り出す。thread_url 経由で
// 別チャンネルに投稿された可能性があるため、inputs ではなく payload を優先する。
function resolveTarget(
  body: unknown,
  inputs: { channel: string },
): { channel: string; ts: string } | null {
  const channel = pickChannelFromBody(body, inputs.channel);
  const ts = pickMessageTsFromBody(body);
  if (!ts) return null;
  return { channel, ts };
}

// 削除は破壊的なため「最初に投稿したユーザだけ」に許可する。権限を満たさなければ
// ephemeral で通知し null を返す（編集は誰でも可なのでこのガードを通さない）。
async function resolveOwnedTarget(
  // deno-lint-ignore no-explicit-any
  body: any,
  inputs: { channel: string; submitted_by: string },
  // deno-lint-ignore no-explicit-any
  client: any,
): Promise<{ channel: string; ts: string } | null> {
  const target = resolveTarget(body, inputs);
  if (!target) return null;

  if (body.user.id !== inputs.submitted_by) {
    await client.chat.postEphemeral({
      channel: target.channel,
      user: body.user.id,
      text: "このメッセージを削除できるのは、最初に投稿したユーザだけです。",
    });
    return null;
  }
  return target;
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

// Slack の送信長エラーは生のコードだと分かりにくいので、原因と対処を案内する。
// 多バイト文字はバイト長が膨らみ、文字数の見た目より早く上限に当たる。
function describePostError(error: string | undefined): string {
  if (error === "msg_too_long" || error === "msg_blocks_too_long") {
    return "内容が Slack のメッセージ上限を超えました（日本語など多バイト文字は見た目の文字数より大きくなります）。文字数を減らすか、不要な行を削ってください。";
  }
  return `投稿に失敗しました: ${error ?? "unknown error"}`;
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
          max_length: EDITABLE_MAX_LEN,
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
      return { error: describePostError(response.error) };
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
      // 編集は投稿者以外にも許可する（編集者は投稿に併記される）。
      const target = resolveTarget(body, inputs);
      if (!target) return;
      const { channel, ts } = target;

      const currentMarkdown = await fetchLatestMarkdown(client, ts);

      // 通常は 3,000 字超の投稿では編集ボタン自体を出さないが、防御的に再確認する。
      // 入力欄は 3,000 字までしか保持できないため、超過分は案内して中断する。
      if (currentMarkdown.length > EDITABLE_MAX_LEN) {
        await client.chat.postEphemeral({
          channel,
          user: body.user.id,
          text:
            `この投稿は ${currentMarkdown.length} 字あり、編集モーダルの上限（${EDITABLE_MAX_LEN} 字）を超えるため、その場では編集できません。修正版を Markdown ファイルとして貼り直してください。`,
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
        // 投稿者は元のまま保ち、今回の編集者（body.user.id）を併記する。
        ...buildMarkdownMessage(newMarkdown, meta.posted_by, body.user.id),
      });

      if (!updated.ok) {
        return inputErrorResponse(describePostError(updated.error));
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
