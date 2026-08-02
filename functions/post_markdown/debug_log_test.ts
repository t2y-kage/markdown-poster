import { assertEquals } from "@std/assert";
import { buildFailureLog, summarizeBlocks } from "./debug_log.ts";

Deno.test("summarizeBlocks: counts blocks per type", () => {
  assertEquals(
    summarizeBlocks([
      { type: "context" },
      { type: "markdown" },
      { type: "table" },
      { type: "markdown" },
      { type: "actions" },
    ]),
    { total: 5, types: { context: 1, markdown: 2, table: 1, actions: 1 } },
  );
});

Deno.test("summarizeBlocks: type-less blocks are counted as unknown", () => {
  assertEquals(summarizeBlocks([{}, { type: 1 }]), {
    total: 2,
    types: { unknown: 2 },
  });
});

Deno.test("buildFailureLog: keeps error, metadata and block summary", () => {
  const log = buildFailureLog(
    "chat.postMessage",
    {
      ok: false,
      error: "invalid_blocks",
      response_metadata: { messages: ["[ERROR] invalid block"] },
    },
    [{ type: "markdown" }, { type: "table" }],
  );
  assertEquals(log, {
    api: "chat.postMessage",
    error: "invalid_blocks",
    response_metadata: { messages: ["[ERROR] invalid block"] },
    blocks: { total: 2, types: { markdown: 1, table: 1 } },
  });
});

Deno.test("buildFailureLog: omits absent fields and tolerates a bare response", () => {
  assertEquals(buildFailureLog("views.open", undefined), {
    api: "views.open",
    error: "unknown error",
  });
});
