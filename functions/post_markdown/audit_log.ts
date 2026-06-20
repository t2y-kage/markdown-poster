// posted_messages Datastore の書き込み / 読み出しヘルパ。
//
// 投稿成否を Datastore の成否に巻き込まないため、書き込み・読み出しは
// いずれも失敗を握り潰してログのみ残す（呼び出し側には throw しない）。

import { PostedMessagesDatastore } from "../../datastores/posted_messages.ts";
import type { Client } from "./client.ts";

export type MessageRecord = {
  channel: string;
  markdown: string;
  submitted_by: string;
  posted_ts: string;
};

// 投稿・編集のたびに 1 行追加する。posted_ts が同じ複数行は created_at 降順で
// 並べた先頭が「現在の状態」を表す。
export async function recordPost(
  client: Client,
  rec: MessageRecord,
): Promise<void> {
  try {
    await client.apps.datastore.put({
      datastore: PostedMessagesDatastore.name,
      item: {
        id: crypto.randomUUID(),
        channel: rec.channel,
        markdown: rec.markdown,
        submitted_by: rec.submitted_by,
        posted_ts: rec.posted_ts,
        created_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[audit_log] recordPost failed:", err);
  }
}

// 指定 ts の最新の markdown を返す。見つからなければ空文字列。
export async function fetchLatestMarkdown(
  client: Client,
  ts: string,
): Promise<string> {
  try {
    const res = await client.apps.datastore.query({
      datastore: PostedMessagesDatastore.name,
      expression: "#posted_ts = :ts",
      expression_attributes: { "#posted_ts": "posted_ts" },
      expression_values: { ":ts": ts },
    });
    if (!res.ok) return "";
    const items = (res.items ?? []) as Array<
      { markdown?: string; created_at?: string }
    >;
    items.sort((a, b) =>
      (b.created_at ?? "").localeCompare(a.created_at ?? "")
    );
    return items[0]?.markdown ?? "";
  } catch (err) {
    console.error("[audit_log] fetchLatestMarkdown failed:", err);
    return "";
  }
}
