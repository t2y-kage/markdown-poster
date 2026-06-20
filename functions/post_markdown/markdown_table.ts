// 本文を「テキスト」と「テーブル」のセグメントに分割する。
//
// markdown ブロックはテーブルの列幅・折り返しを制御できず、長文セルがあると横に
// 伸びて横スクロールになる。そこで GFM テーブルだけを検出して table ブロック
// （列ごとに折り返し可）で描画するため、ここで本文を切り分ける。
// 生の Markdown は保存・編集の正のまま、描画時にこの関数でパースする。

export type Segment =
  | { kind: "text"; text: string }
  // rows[0] はヘッダ行。各セルはトリム済みのプレーンテキスト。
  | { kind: "table"; rows: string[][] };

// 行を `|` 区切りのセルに分解する。先頭・末尾の `|` は除去する。
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((cell) => cell.trim());
}

function isTableRow(line: string): boolean {
  return line.trim() !== "" && line.includes("|");
}

// 区切り行（`| --- | :--: |` など）。各セルが `-`（前後に任意の `:`）のみ。
function isSeparatorRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

export function splitIntoSegments(markdown: string): Segment[] {
  const lines = markdown.split("\n");
  const segments: Segment[] = [];
  let textBuf: string[] = [];

  const flushText = () => {
    const text = textBuf.join("\n").replace(/^\n+|\n+$/g, "");
    if (text.trim() !== "") segments.push({ kind: "text", text });
    textBuf = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];
    // ヘッダ行の直後に同じ列数の区切り行が続けばテーブルとみなす。
    const isTableStart = isTableRow(line) && next !== undefined &&
      isSeparatorRow(next) && splitRow(next).length === splitRow(line).length;

    if (isTableStart) {
      flushText();
      const rows: string[][] = [splitRow(line)];
      i += 2; // ヘッダ + 区切り行を消費
      while (
        i < lines.length && isTableRow(lines[i]) && !isSeparatorRow(lines[i])
      ) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      segments.push({ kind: "table", rows });
    } else {
      textBuf.push(line);
      i++;
    }
  }
  flushText();
  return segments;
}
