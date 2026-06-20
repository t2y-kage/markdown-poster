import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { PostMarkdownDefinition } from "../functions/post_markdown/definition.ts";

export const PostMarkdownWorkflow = DefineWorkflow({
  callback_id: "post_markdown_workflow",
  title: "Post markdown",
  description: "Open a form to collect Markdown and post it as a rich message.",
  input_parameters: {
    properties: {
      interactivity: { type: Schema.slack.types.interactivity },
      channel: { type: Schema.slack.types.channel_id },
    },
    required: ["interactivity"],
  },
});

const formStep = PostMarkdownWorkflow.addStep(
  Schema.slack.functions.OpenForm,
  {
    title: "Post markdown",
    submit_label: "Post",
    description: "Paste Markdown to post it as a rich message.",
    interactivity: PostMarkdownWorkflow.inputs.interactivity,
    fields: {
      required: ["channel", "markdown"],
      elements: [
        {
          name: "channel",
          title: "Channel",
          type: Schema.slack.types.channel_id,
          default: PostMarkdownWorkflow.inputs.channel,
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

PostMarkdownWorkflow.addStep(PostMarkdownDefinition, {
  channel: formStep.outputs.fields.channel,
  markdown: formStep.outputs.fields.markdown,
  thread_url: formStep.outputs.fields.thread_url,
  submitted_by: PostMarkdownWorkflow.inputs.interactivity.interactor.id,
});
