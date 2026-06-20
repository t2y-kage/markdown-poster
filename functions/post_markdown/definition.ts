import { DefineFunction, Schema } from "deno-slack-sdk/mod.ts";

export const PostMarkdownDefinition = DefineFunction({
  callback_id: "post_markdown",
  title: "Post markdown",
  description:
    "Post Markdown as a rich message. Optionally post as a thread reply when thread_url is provided.",
  source_file: "functions/post_markdown/mod.ts",
  input_parameters: {
    properties: {
      channel: {
        type: Schema.slack.types.channel_id,
        description: "Destination channel",
      },
      markdown: {
        type: Schema.types.string,
        description: "Markdown text",
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
