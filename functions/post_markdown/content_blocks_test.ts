import { assertEquals } from "@std/assert";
import { buildContentBlocks } from "./content_blocks.ts";

Deno.test("buildContentBlocks: plain text is a single markdown block", () => {
  const blocks = buildContentBlocks("ふつうの本文");
  assertEquals(blocks, [{ type: "markdown", text: "ふつうの本文" }]);
});

Deno.test("buildContentBlocks: text around a table yields markdown/table/markdown", () => {
  const blocks = buildContentBlocks(
    "前文\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n後文",
  );
  assertEquals(blocks.map((b) => b.type), ["markdown", "table", "markdown"]);
});

Deno.test("buildContentBlocks: a GFM table becomes a wrapped table block", () => {
  const blocks = buildContentBlocks("| a | b |\n| --- | --- |\n| 1 | 2 |");
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].type, "table");
  // 全列が折り返し（横スクロール回避）。
  assertEquals(blocks[0].column_settings, [
    { is_wrapped: true },
    { is_wrapped: true },
  ]);
  const rows = blocks[0].rows as Array<Array<{ type: string; text: string }>>;
  assertEquals(rows[0], [
    { type: "raw_text", text: "a" },
    { type: "raw_text", text: "b" },
  ]);
  assertEquals(rows[1], [
    { type: "raw_text", text: "1" },
    { type: "raw_text", text: "2" },
  ]);
});

Deno.test("buildContentBlocks: empty cells never produce empty text", () => {
  // 先頭ヘッダが空・本文行のセル数が足りない、どちらも invalid_blocks の原因。
  const blocks = buildContentBlocks(
    "| | 帯域比 | 電力比 |\n|---|---|---|\n| A | **6.6倍** |",
  );
  const rows = blocks[0].rows as Array<Array<Record<string, unknown>>>;
  assertEquals(rows[0][0], { type: "raw_text", text: " " });
  // 列数の足りない行は空セルで補われる。
  assertEquals(rows[1].length, 3);
  assertEquals(rows[1][2], { type: "raw_text", text: " " });
  // 空文字の text を持つセルが 1 つも無いこと。
  for (const row of rows) {
    for (const cell of row) {
      assertEquals(cell.text === "", false);
    }
  }
});

Deno.test("buildContentBlocks: whitespace-only cells are treated as empty", () => {
  const blocks = buildContentBlocks("| a |   |\n| --- | --- |\n| 1 | 2 |");
  const rows = blocks[0].rows as Array<Array<Record<string, unknown>>>;
  assertEquals(rows[0][1], { type: "raw_text", text: " " });
});

Deno.test("buildContentBlocks: table cells render markdown as rich_text", () => {
  const blocks = buildContentBlocks(
    "| 名前 | メモ |\n| --- | --- |\n| A | **重要** |",
  );
  const rows = blocks[0].rows as Array<Array<Record<string, unknown>>>;
  // 装飾なしセルは raw_text のまま。
  assertEquals(rows[1][0], { type: "raw_text", text: "A" });
  // 装飾ありセルは rich_text。
  assertEquals(rows[1][1], {
    type: "rich_text",
    elements: [
      {
        type: "rich_text_section",
        elements: [{ type: "text", text: "重要", style: { bold: true } }],
      },
    ],
  });
});
