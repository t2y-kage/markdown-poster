import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export const PostedMessagesDatastore = DefineDatastore({
  name: "posted_messages",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    channel: { type: Schema.slack.types.channel_id },
    markdown: { type: Schema.types.string },
    submitted_by: { type: Schema.slack.types.user_id },
    posted_ts: { type: Schema.types.string },
    created_at: { type: Schema.types.string },
  },
});
