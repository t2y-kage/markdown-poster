import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { PostMarkdownTableDefinition } from "../functions/post_markdown_table/definition.ts";

export const PostMarkdownTableWorkflow = DefineWorkflow({
  callback_id: "post_markdown_table_workflow",
  title: "Post markdown table",
  description:
    "Open a form to collect a Markdown table and post it as a rich table.",
  input_parameters: {
    properties: {
      interactivity: { type: Schema.slack.types.interactivity },
      channel: { type: Schema.slack.types.channel_id },
    },
    required: ["interactivity"],
  },
});

const formStep = PostMarkdownTableWorkflow.addStep(
  Schema.slack.functions.OpenForm,
  {
    title: "Post markdown table",
    submit_label: "Post",
    description: "Paste a Markdown table to post it as a rich table.",
    interactivity: PostMarkdownTableWorkflow.inputs.interactivity,
    fields: {
      required: ["channel", "markdown"],
      elements: [
        {
          name: "channel",
          title: "Channel",
          type: Schema.slack.types.channel_id,
          default: PostMarkdownTableWorkflow.inputs.channel,
        },
        {
          name: "thread_url",
          title: "Thread URL (optional)",
          description:
            "スレッド返信として投稿する場合、対象メッセージの「リンクをコピー」した URL を貼ってください。空欄ならトップレベル投稿",
          type: Schema.types.string,
        },
        {
          name: "markdown",
          title: "Markdown",
          type: Schema.types.string,
          long: true,
        },
      ],
    },
  },
);

PostMarkdownTableWorkflow.addStep(PostMarkdownTableDefinition, {
  channel: formStep.outputs.fields.channel,
  markdown: formStep.outputs.fields.markdown,
  thread_url: formStep.outputs.fields.thread_url,
  submitted_by: PostMarkdownTableWorkflow.inputs.interactivity.interactor.id,
});
