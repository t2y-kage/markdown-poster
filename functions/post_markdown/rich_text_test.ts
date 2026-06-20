import { assertEquals } from "@std/assert";
import { parseInlineRichText } from "./rich_text.ts";

Deno.test("parseInlineRichText: plain text is one text element with no style", () => {
  assertEquals(parseInlineRichText("ふつうの文"), [
    { type: "text", text: "ふつうの文" },
  ]);
});

Deno.test("parseInlineRichText: bold, italic, strike, code", () => {
  assertEquals(parseInlineRichText("**B**"), [
    { type: "text", text: "B", style: { bold: true } },
  ]);
  assertEquals(parseInlineRichText("*I*"), [
    { type: "text", text: "I", style: { italic: true } },
  ]);
  assertEquals(parseInlineRichText("~~S~~"), [
    { type: "text", text: "S", style: { strike: true } },
  ]);
  assertEquals(parseInlineRichText("`C`"), [
    { type: "text", text: "C", style: { code: true } },
  ]);
});

Deno.test("parseInlineRichText: links become link elements", () => {
  assertEquals(parseInlineRichText("[Slack](https://slack.com)"), [
    { type: "link", url: "https://slack.com", text: "Slack" },
  ]);
});

Deno.test("parseInlineRichText: mixes text and emphasis", () => {
  assertEquals(parseInlineRichText("重要: **至急** 対応"), [
    { type: "text", text: "重要: " },
    { type: "text", text: "至急", style: { bold: true } },
    { type: "text", text: " 対応" },
  ]);
});

Deno.test("parseInlineRichText: nested emphasis combines styles", () => {
  assertEquals(parseInlineRichText("**a _b_**"), [
    { type: "text", text: "a ", style: { bold: true } },
    { type: "text", text: "b", style: { bold: true, italic: true } },
  ]);
});

Deno.test("parseInlineRichText: underscores inside a word are not italic", () => {
  assertEquals(parseInlineRichText("file_source_name"), [
    { type: "text", text: "file_source_name" },
  ]);
});

Deno.test("parseInlineRichText: an unclosed delimiter stays literal", () => {
  assertEquals(parseInlineRichText("a * b"), [
    { type: "text", text: "a * b" },
  ]);
});

Deno.test("parseInlineRichText: a link inside bold keeps the style", () => {
  assertEquals(parseInlineRichText("**[x](u)**"), [
    { type: "link", url: "u", text: "x", style: { bold: true } },
  ]);
});
