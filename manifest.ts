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
  // 添付ファイル本体（url_private_download）を bot token 付きで取得するため必要。
  outgoingDomains: ["files.slack.com"],
  botScopes: [
    "chat:write",
    "chat:write.public",
    "datastore:read",
    "datastore:write",
    // フォームに添付されたファイルを読み取るため必要。
    "files:read",
  ],
});
