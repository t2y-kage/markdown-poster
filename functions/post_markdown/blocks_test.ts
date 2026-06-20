import { assert, assertEquals } from "@std/assert";
import {
  buildFallbackText,
  buildMarkdownBlocks,
  DELETE_ACTION_ID,
  EDIT_ACTION_ID,
  EDITABLE_MAX_LEN,
  FALLBACK_MAX_BYTES,
} from "./blocks.ts";

const utf8 = new TextEncoder();

Deno.test("buildFallbackText: short text is returned unchanged", () => {
  const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  assertEquals(buildFallbackText(md), md);
});

Deno.test("buildFallbackText: long ASCII text is byte-capped and ends in …", () => {
  const out = buildFallbackText("x".repeat(5000));
  assert(utf8.encode(out).length <= FALLBACK_MAX_BYTES);
  assertEquals(out.endsWith("…"), true);
});

Deno.test("buildFallbackText: multibyte text is capped by bytes, not chars", () => {
  // 日本語 1 文字 = 3 バイト。1000 文字 = 3000 バイトで上限を超えるため切り詰められる。
  const out = buildFallbackText("あ".repeat(1000));
  assert(utf8.encode(out).length <= FALLBACK_MAX_BYTES);
  assertEquals(out.endsWith("…"), true);
  // マルチバイト文字の途中で切れていない（デコード可能な文字列のまま）。
  assert(out.length < 1000);
});

Deno.test("buildMarkdownBlocks: emits a markdown block followed by edit/delete actions", () => {
  const blocks = buildMarkdownBlocks("ふつうの本文");
  assertEquals(blocks[0].type, "markdown");
  assertEquals(blocks[0].text, "ふつうの本文");
  assertEquals(blocks[1].type, "actions");
  const elements = blocks[1].elements as Array<{ action_id: string }>;
  assertEquals(elements[0].action_id, EDIT_ACTION_ID);
  assertEquals(elements[1].action_id, DELETE_ACTION_ID);
});

Deno.test("buildMarkdownBlocks: renders a GFM table as a wrapped table block", () => {
  const blocks = buildMarkdownBlocks("| a | b |\n| --- | --- |\n| 1 | 2 |");
  assertEquals(blocks[0].type, "table");
  const settings = blocks[0].column_settings as Array<{ is_wrapped: boolean }>;
  // 全列が折り返し（横スクロール回避）。
  assertEquals(settings, [{ is_wrapped: true }, { is_wrapped: true }]);
  const rows = blocks[0].rows as Array<Array<{ type: string; text: string }>>;
  assertEquals(rows[0], [
    { type: "raw_text", text: "a" },
    { type: "raw_text", text: "b" },
  ]);
  assertEquals(rows[1], [
    { type: "raw_text", text: "1" },
    { type: "raw_text", text: "2" },
  ]);
  // テーブルの後ろに actions ブロックが続く。
  assertEquals(blocks[1].type, "actions");
});

Deno.test("buildMarkdownBlocks: hides the edit button when over the editable cap", () => {
  const blocks = buildMarkdownBlocks("x".repeat(EDITABLE_MAX_LEN + 1));
  const elements = blocks[1].elements as Array<{ action_id: string }>;
  // 編集ボタンは出さず、削除ボタンのみ。
  assertEquals(elements.length, 1);
  assertEquals(elements[0].action_id, DELETE_ACTION_ID);
});

Deno.test("buildMarkdownBlocks: keeps the edit button at exactly the editable cap", () => {
  const blocks = buildMarkdownBlocks("x".repeat(EDITABLE_MAX_LEN));
  const elements = blocks[1].elements as Array<{ action_id: string }>;
  assertEquals(elements[0].action_id, EDIT_ACTION_ID);
});

Deno.test("buildMarkdownBlocks: prepends a poster context block when postedBy is given", () => {
  const blocks = buildMarkdownBlocks("# hi", "U123");
  assertEquals(blocks[0].type, "context");
  const elements = blocks[0].elements as Array<{ type: string; text: string }>;
  assertEquals(elements[0], { type: "mrkdwn", text: "投稿者: <@U123>" });
  assertEquals(blocks[1].type, "markdown");
  assertEquals(blocks[2].type, "actions");
});

Deno.test("buildMarkdownBlocks: appends an editor line when the editor differs", () => {
  const blocks = buildMarkdownBlocks("# hi", "U123", "U999");
  const elements = blocks[0].elements as Array<{ type: string; text: string }>;
  assertEquals(elements[0].text, "投稿者: <@U123>\n編集者: <@U999>");
});

Deno.test("buildMarkdownBlocks: omits the editor line when editor equals poster", () => {
  const blocks = buildMarkdownBlocks("# hi", "U123", "U123");
  const elements = blocks[0].elements as Array<{ type: string; text: string }>;
  assertEquals(elements[0].text, "投稿者: <@U123>");
});
