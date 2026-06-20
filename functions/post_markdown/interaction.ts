// block_actions / view interaction の payload からチャンネル・メッセージ ts を
// 取り出し、操作対象を解決するヘルパ群。編集・削除ハンドラで共有する。

import type { Client } from "./client.ts";

// block_actions payload は deno-slack-sdk の body 型に一部フィールドが現れないので、
// ここで構造アサーションを集約する。
type ActionBodyShape = {
  channel?: { id?: string };
  container?: { channel_id?: string; message_ts?: string };
  message?: { ts?: string };
};

export function pickChannelFromBody(body: unknown, fallback: string): string {
  const b = body as ActionBodyShape;
  return b.channel?.id ?? b.container?.channel_id ?? fallback;
}

export function pickMessageTsFromBody(body: unknown): string | undefined {
  const b = body as ActionBodyShape;
  return b.container?.message_ts ?? b.message?.ts;
}

export type ActionTarget = { channel: string; ts: string };

// 操作対象メッセージの channel/ts を payload から取り出す。thread_url 経由で
// 別チャンネルに投稿された可能性があるため、inputs ではなく payload を優先する。
export function resolveTarget(
  body: unknown,
  inputs: { channel: string },
): ActionTarget | null {
  const channel = pickChannelFromBody(body, inputs.channel);
  const ts = pickMessageTsFromBody(body);
  if (!ts) return null;
  return { channel, ts };
}

// 「最初に投稿したユーザだけ」に許可する操作（削除）のためのガード。権限を満たさ
// なければ ephemeral で通知し null を返す（編集は誰でも可なのでこれを通さない）。
export async function resolveOwnedTarget(
  body: { user: { id: string } },
  inputs: { channel: string; submitted_by: string },
  client: Client,
): Promise<ActionTarget | null> {
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
