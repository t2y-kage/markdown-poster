import { assertEquals } from "@std/assert";
import { type Segment, splitIntoSegments } from "./markdown_table.ts";

Deno.test("splitIntoSegments: plain text is a single text segment", () => {
  assertEquals(splitIntoSegments("# hi\nhello"), [
    { kind: "text", text: "# hi\nhello" },
  ]);
});

Deno.test("splitIntoSegments: a GFM table becomes a table segment", () => {
  const md = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
  assertEquals(splitIntoSegments(md), [
    { kind: "table", rows: [["a", "b"], ["1", "2"], ["3", "4"]] },
  ]);
});

Deno.test("splitIntoSegments: text around a table splits into three segments", () => {
  const md = "intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\noutro";
  const segs = splitIntoSegments(md);
  assertEquals(segs.map((s: Segment) => s.kind), ["text", "table", "text"]);
  assertEquals(segs[0], { kind: "text", text: "intro" });
  assertEquals(segs[2], { kind: "text", text: "outro" });
});

Deno.test("splitIntoSegments: cells are trimmed and outer pipes dropped", () => {
  const md = "|  名前  |  数量 |\n| --- | --- |\n|  りんご |  3 |";
  assertEquals(splitIntoSegments(md), [
    { kind: "table", rows: [["名前", "数量"], ["りんご", "3"]] },
  ]);
});

Deno.test("splitIntoSegments: a pipe line without a separator stays text", () => {
  const md = "a | b は区切りではない\nふつうの文";
  assertEquals(splitIntoSegments(md), [
    { kind: "text", text: "a | b は区切りではない\nふつうの文" },
  ]);
});

Deno.test("splitIntoSegments: separator column count must match the header", () => {
  // ヘッダ 2 列に対し区切りが 1 列 → テーブルとみなさない（setext 見出し等の誤検出回避）。
  const md = "見出し | テキスト\n---";
  assertEquals(splitIntoSegments(md)[0].kind, "text");
});
