import { Manifest } from "deno-slack-sdk/mod.ts";
import { PostMarkdownWorkflow } from "./workflows/post_markdown.ts";
import { PostMarkdownDefinition } from "./functions/post_markdown/definition.ts";
import { PostedMessagesDatastore } from "./datastores/posted_messages.ts";

export default Manifest({
  name: "markdown-poster",
  description: "Post Markdown to Slack as rich messages.",
  icon: "assets/icon.png",
  workflows: [PostMarkdownWorkflow],
  functions: [PostMarkdownDefinition],
  datastores: [PostedMessagesDatastore],
  outgoingDomains: [],
  botScopes: [
    "chat:write",
    "chat:write.public",
    "datastore:read",
    "datastore:write",
  ],
});
