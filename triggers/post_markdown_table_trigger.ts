import { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import { PostMarkdownTableWorkflow } from "../workflows/post_markdown_table.ts";

const trigger: Trigger<typeof PostMarkdownTableWorkflow.definition> = {
  type: TriggerTypes.Shortcut,
  name: "Post markdown table",
  description: "Open a form and post a Markdown table to a channel.",
  workflow: `#/workflows/${PostMarkdownTableWorkflow.definition.callback_id}`,
  inputs: {
    interactivity: { value: TriggerContextData.Shortcut.interactivity },
    channel: { value: TriggerContextData.Shortcut.channel_id },
  },
};

export default trigger;
