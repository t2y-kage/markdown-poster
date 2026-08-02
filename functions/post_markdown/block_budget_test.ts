import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildMarkdownBlocks } from "./blocks.ts";
import {
  checkBlockBudget,
  estimateExpandedBlocks,
  MAX_EXPANDED_BLOCKS,
} from "./block_budget.ts";

Deno.test("estimateExpandedBlocks: headings and dividers each cost one block", () => {
  const budget = estimateExpandedBlocks([
    {
      type: "markdown",
      text: "# 見出し\n\n本文\n\n---\n\n## 見出し2\n\n本文2",
    },
  ]);
  assertEquals(budget.headings, 2);
  assertEquals(budget.dividers, 1);
  assertEquals(budget.textRuns, 2);
  assertEquals(budget.total, 5);
});

Deno.test("estimateExpandedBlocks: consecutive paragraphs collapse into one block", () => {
  const text = Array.from({ length: 50 }, (_, i) => `段落 ${i}`).join("\n\n");
  const budget = estimateExpandedBlocks([{ type: "markdown", text }]);
  assertEquals(budget.textRuns, 1);
  assertEquals(budget.total, 1);
});

Deno.test("estimateExpandedBlocks: headings inside a code fence are not counted", () => {
  const budget = estimateExpandedBlocks([
    {
      type: "markdown",
      text: "本文\n\n```\n# これは見出しではない\n---\n```\n\n続き",
    },
  ]);
  assertEquals(budget.headings, 0);
  assertEquals(budget.dividers, 0);
  // 本文・フェンス・続きは区切られていないので 1 かたまり。
  assertEquals(budget.textRuns, 1);
});

Deno.test("estimateExpandedBlocks: tables and other blocks count as one each", () => {
  const budget = estimateExpandedBlocks([
    { type: "context" },
    { type: "markdown", text: "## 見出し\n\n本文" },
    { type: "table" },
    { type: "table" },
    { type: "actions" },
  ]);
  assertEquals(budget.tables, 2);
  assertEquals(budget.other, 2);
  assertEquals(budget.total, 6);
});

Deno.test("checkBlockBudget: passes at the limit and fails past it", () => {
  // 見出しだけを並べて、展開後がちょうど上限になる本文を作る。
  const atLimit = Array.from(
    { length: MAX_EXPANDED_BLOCKS },
    (_, i) => `# 見出し ${i}`,
  ).join("\n\n");
  assertEquals(
    estimateExpandedBlocks([{ type: "markdown", text: atLimit }]).total,
    MAX_EXPANDED_BLOCKS,
  );
  assertEquals(
    checkBlockBudget([{ type: "markdown", text: atLimit }]).ok,
    true,
  );

  const overLimit = `${atLimit}\n\n# もう 1 つ`;
  const result = checkBlockBudget([{ type: "markdown", text: overLimit }]);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.budget.total, MAX_EXPANDED_BLOCKS + 1);
    assertStringIncludes(result.message, "51 ブロック");
    assertStringIncludes(result.message, "1 ブロック以上減らして");
  }
});

Deno.test("checkBlockBudget: a heading-and-divider heavy document is rejected", () => {
  // 見出し + 区切り線 + 本文 + テーブルを繰り返す。投稿側のブロック数は 20 個台でも
  // 展開後は 50 を超える、という実際に起きたケースを再現する。
  const section = (n: number) =>
    `## セクション ${n}\n\n本文 ${n}\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n---\n`;
  const markdown = Array.from({ length: 13 }, (_, i) => section(i + 1)).join(
    "\n",
  );

  const blocks = buildMarkdownBlocks(markdown, "U123");
  assertEquals(blocks.length <= MAX_EXPANDED_BLOCKS, true);

  const result = checkBlockBudget(blocks);
  assertEquals(result.ok, false);
  if (!result.ok) {
    // 送信は 29 ブロックでも、展開後は 13×(見出し+区切り線+本文+テーブル)+2 = 54。
    assertEquals(result.budget.total, 54);
    assertEquals(result.budget.tables, 13);
    assertEquals(result.budget.headings, 13);
    assertEquals(result.budget.dividers, 13);
  }
});
