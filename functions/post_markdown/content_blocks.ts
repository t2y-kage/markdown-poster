// 本文（生 Markdown）を Block Kit のブロック列に変換する。
// テキストは markdown ブロック、GFM テーブルは table ブロック（列ごとに折り返し）で
// 描画する。テーブルのセル装飾は rich_text に変換する。

import type { Block } from "./blocks.ts";
import { splitIntoSegments } from "./markdown_table.ts";
import { parseInlineRichText } from "./rich_text.ts";

// セルをテーブルセルに変換する。装飾の無いセルは raw_text、Markdown 装飾を含む
// セルは rich_text にする（太字・斜体・打消し・コード・リンクを反映）。
function buildCell(text: string): Block {
  const els = parseInlineRichText(text);
  if (els.length === 0) return { type: "raw_text", text: "" };
  if (els.length === 1 && els[0].type === "text" && !els[0].style) {
    return { type: "raw_text", text: els[0].text };
  }
  return {
    type: "rich_text",
    elements: [{ type: "rich_text_section", elements: els }],
  };
}

// GFM テーブルを table ブロックにする。全列を折り返し（is_wrapped）にして、
// 長文セルがあっても横スクロールせず適度に改行されるようにする（実際の折り返し
// 位置は Slack クライアントに委ねる）。
function buildTableBlock(rows: string[][]): Block {
  const colCount = Math.max(...rows.map((row) => row.length));
  return {
    type: "table",
    column_settings: Array.from({ length: colCount }, () => ({
      is_wrapped: true,
    })),
    rows: rows.map((row) =>
      Array.from({ length: colCount }, (_, i) => buildCell(row[i] ?? ""))
    ),
  };
}

// 本文を markdown ブロック（テキスト）と table ブロック（GFM テーブル）に分けて
// 組み立てる。テーブルが無ければ従来どおり単一の markdown ブロックになる。
export function buildContentBlocks(markdown: string): Block[] {
  return splitIntoSegments(markdown).map((seg) =>
    seg.kind === "table"
      ? buildTableBlock(seg.rows)
      : { type: "markdown", text: seg.text }
  );
}
