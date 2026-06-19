import { DefineFunction, Schema } from "deno-slack-sdk/mod.ts";

export const PostMarkdownTableDefinition = DefineFunction({
  callback_id: "post_markdown_table",
  title: "Post markdown table",
  description:
    "Post a Markdown table as a rich table. Optionally post as a thread reply when thread_url is provided.",
  source_file: "functions/post_markdown_table/mod.ts",
  input_parameters: {
    properties: {
      channel: {
        type: Schema.slack.types.channel_id,
        description: "Destination channel",
      },
      markdown: {
        type: Schema.types.string,
        description: "Markdown text (typically a table)",
      },
      submitted_by: {
        type: Schema.slack.types.user_id,
        description: "User who submitted the form (allowed to edit)",
      },
      thread_url: {
        type: Schema.types.string,
        description:
          "Optional Slack message URL. When provided, post is threaded under that message and the channel is overridden by the URL.",
      },
    },
    required: ["channel", "markdown", "submitted_by"],
  },
});
