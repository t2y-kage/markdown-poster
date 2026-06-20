import { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import { PostMarkdownWorkflow } from "../workflows/post_markdown.ts";

const trigger: Trigger<typeof PostMarkdownWorkflow.definition> = {
  type: TriggerTypes.Shortcut,
  name: "Post markdown",
  description: "Open a form and post Markdown to a channel.",
  workflow: `#/workflows/${PostMarkdownWorkflow.definition.callback_id}`,
  inputs: {
    interactivity: { value: TriggerContextData.Shortcut.interactivity },
    channel: { value: TriggerContextData.Shortcut.channel_id },
  },
};

export default trigger;
