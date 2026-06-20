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
      // markdown 直貼りと file 添付は排他（XOR）。どちらか一方を求めるが
      // OpenForm の required はフィールド単位でしか書けないため、両方を任意に
      // して関数内で XOR を検証する。
      required: ["channel"],
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
          title: "Markdown（直貼り）",
          description:
            "短い Markdown はここに貼り付け（〜3,000字）。長文はファイル添付を使ってください。",
          type: Schema.types.string,
          long: true,
          // markdown ブロックの上限に合わせる。超過時はフォーム送信が
          // バリデーションエラーでブロックされる（サイレント切り捨てを防ぐ）。
          maxLength: 3000,
        },
        {
          name: "file",
          title: "Markdown ファイル（添付）",
          description:
            "長文 Markdown はテキストファイルとして添付（〜12,000字）。直貼りと同時には使えません。",
          type: Schema.types.array,
          items: { type: Schema.slack.types.file_id },
          maxItems: 1,
        },
      ],
    },
  },
);

PostMarkdownWorkflow.addStep(PostMarkdownDefinition, {
  channel: formStep.outputs.fields.channel,
  markdown: formStep.outputs.fields.markdown,
  file: formStep.outputs.fields.file,
  thread_url: formStep.outputs.fields.thread_url,
  submitted_by: PostMarkdownWorkflow.inputs.interactivity.interactor.id,
});
