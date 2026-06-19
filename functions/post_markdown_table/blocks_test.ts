import { assertEquals } from "@std/assert";
import {
  buildFallbackText,
  buildTableBlocks,
  EDIT_ACTION_ID,
} from "./blocks.ts";

Deno.test("buildFallbackText: short text is returned unchanged", () => {
  const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  assertEquals(buildFallbackText(md), md);
});

Deno.test("buildFallbackText: text shorter than the cap keeps its trailing char", () => {
  const md = "x".repeat(2999);
  assertEquals(buildFallbackText(md), md);
});

Deno.test("buildFallbackText: text at/over the cap is truncated to 3000 chars ending in …", () => {
  const truncated = buildFallbackText("x".repeat(5000));
  assertEquals(truncated.length, 3000);
  assertEquals(truncated.endsWith("…"), true);
  assertEquals(truncated.slice(0, -1), "x".repeat(2999));
});

Deno.test("buildTableBlocks: emits a markdown block followed by an edit actions block", () => {
  const blocks = buildTableBlocks("| a |\n| --- |\n| 1 |");
  assertEquals(blocks[0].type, "markdown");
  assertEquals(blocks[0].text, "| a |\n| --- |\n| 1 |");
  assertEquals(blocks[1].type, "actions");
  const elements = blocks[1].elements as Array<{ action_id: string }>;
  assertEquals(elements[0].action_id, EDIT_ACTION_ID);
});
