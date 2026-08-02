// 投稿前に手元で Markdown を検査する CLI。
//
// Slack にアップロードした時点ではもう遅い（アプリが中身を読めるのはワークフロー
// 開始後）ため、アップロードする前にここで確認する。判定はアプリ本体と同じ
// block_budget.ts / file_source.ts を使うので、結果は投稿時と一致する。
//
//   deno task check path/to/foo.md [...]
//
// 上限を超えるファイルがあれば終了コード 1 を返す。

import { buildMarkdownBlocks } from "../functions/post_markdown/blocks.ts";
import {
  checkBlockBudget,
  estimateExpandedBlocks,
  MAX_EXPANDED_BLOCKS,
} from "../functions/post_markdown/block_budget.ts";
import {
  enforceLengthLimit,
  MARKDOWN_MAX_LEN,
} from "../functions/post_markdown/file_source.ts";

if (Deno.args.length === 0) {
  console.error("使い方: deno task check <file.md> [...]");
  Deno.exit(2);
}

let failed = false;

for (const path of Deno.args) {
  const markdown = await Deno.readTextFile(path);
  // 投稿時と同じ形にする（投稿者 context とボタン actions もブロックを消費する）。
  const blocks = buildMarkdownBlocks(markdown, "U0000000000");
  const budget = estimateExpandedBlocks(blocks);
  const length = enforceLengthLimit(markdown);
  const limit = checkBlockBudget(blocks);

  console.log(`\n${path}`);
  console.log(
    `  文字数: ${markdown.length} / ${MARKDOWN_MAX_LEN}` +
      (length.ok ? "" : "  ← 超過"),
  );
  console.log(
    `  展開後のブロック数: ${budget.total} / ${MAX_EXPANDED_BLOCKS}` +
      (limit.ok ? "" : "  ← 超過"),
  );
  console.log(
    `    見出し ${budget.headings} / 区切り線 ${budget.dividers} / ` +
      `本文 ${budget.textRuns} / テーブル ${budget.tables} / その他 ${budget.other}`,
  );

  if (!length.ok) {
    failed = true;
    console.log(`  ${length.message}`);
  }
  if (!limit.ok) {
    failed = true;
    console.log(`  ${limit.message.split("\n").join("\n  ")}`);
  }
  if (length.ok && limit.ok) console.log("  投稿できます。");
}

Deno.exit(failed ? 1 : 0);
