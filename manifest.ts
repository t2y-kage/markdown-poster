import { Manifest } from "deno-slack-sdk/mod.ts";
import { PostMarkdownTableWorkflow } from "./workflows/post_markdown_table.ts";
import { PostMarkdownTableDefinition } from "./functions/post_markdown_table/definition.ts";
import { PostedTablesDatastore } from "./datastores/posted_tables.ts";

export default Manifest({
  name: "markdown-table-poster",
  description: "Post Markdown tables to Slack as rich tables.",
  workflows: [PostMarkdownTableWorkflow],
  functions: [PostMarkdownTableDefinition],
  datastores: [PostedTablesDatastore],
  outgoingDomains: [],
  botScopes: [
    "chat:write",
    "chat:write.public",
    "datastore:read",
    "datastore:write",
  ],
});
