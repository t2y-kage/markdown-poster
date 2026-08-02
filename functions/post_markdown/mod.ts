import { SlackFunction } from "deno-slack-sdk/mod.ts";
import { PostMarkdownDefinition } from "./definition.ts";
import {
  buildMarkdownMessage,
  DELETE_ACTION_ID,
  EDIT_ACTION_ID,
  EDITABLE_MAX_LEN,
} from "./blocks.ts";
import { logApiFailure } from "./debug_log.ts";
import { parseThreadUrl } from "./thread_url.ts";
import { fetchLatestMarkdown, recordPost } from "./audit_log.ts";
import {
  downloadFileText,
  enforceLengthLimit,
  resolveSource,
} from "./file_source.ts";
import { resolveOwnedTarget, resolveTarget } from "./interaction.ts";
import {
  buildEditModalView,
  EDIT_MODAL_CALLBACK_ID,
  inputErrorResponse,
  parseEditMeta,
  readMarkdownInput,
} from "./edit_modal.ts";

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

// Slack の送信長エラーは生のコードだと分かりにくいので、原因と対処を案内する。
// 多バイト文字はバイト長が膨らみ、文字数の見た目より早く上限に当たる。
function describePostError(error: string | undefined): string {
  if (error === "msg_too_long" || error === "msg_blocks_too_long") {
    return "内容が Slack のメッセージ上限を超えました（日本語など多バイト文字は見た目の文字数より大きくなります）。文字数を減らすか、不要な行を削ってください。";
  }
  return `投稿に失敗しました: ${error ?? "unknown error"}`;
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

    const message = buildMarkdownMessage(text, submitted_by);
    const response = await client.chat.postMessage({
      channel: target.channel,
      ...message,
      ...(target.thread_ts ? { thread_ts: target.thread_ts } : {}),
    });

    if (!response.ok) {
      logApiFailure("chat.postMessage", response, message.blocks);
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
        logApiFailure("views.open", view);
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

      const newMarkdown = readMarkdownInput(view);
      if (newMarkdown.trim() === "") {
        return inputErrorResponse("Markdown を入力してください。");
      }

      // 投稿者は元のまま保ち、今回の編集者（body.user.id）を併記する。
      const message = buildMarkdownMessage(
        newMarkdown,
        meta.posted_by,
        body.user.id,
      );
      const updated = await client.chat.update({
        channel: meta.channel,
        ts: meta.ts,
        ...message,
      });

      if (!updated.ok) {
        logApiFailure("chat.update", updated, message.blocks);
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
