// インライン Markdown を Slack rich_text の要素列へ変換する。
// table ブロックのセル装飾（太字・斜体・打消し・コード・リンク）に使う。
//
// 対応記法: **太字** / __太字__、*斜体* / _斜体_、~~打消し~~、`コード`、[文字](URL)。
// 装飾はネスト可（例: **a _b_** は太字 + 太字斜体）。三重 `***` などの特殊な
// 入れ子は完全にはサポートしない（一般的なセル装飾を優先）。

export type InlineStyle = {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
};

export type RichTextElement =
  | { type: "text"; text: string; style?: InlineStyle }
  | { type: "link"; url: string; text: string; style?: InlineStyle };

function hasStyle(style: InlineStyle): boolean {
  return Boolean(style.bold || style.italic || style.strike || style.code);
}

function withStyle(el: RichTextElement, style: InlineStyle): RichTextElement {
  return hasStyle(style) ? { ...el, style } : el;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /\w/.test(ch);
}

// アンダースコアの強調は単語内（snake_case 等）を装飾しないよう境界を要求する。
function delimOpenOk(text: string, i: number, delim: string): boolean {
  if (delim === "_" || delim === "__") return !isWordChar(text[i - 1]);
  return true;
}

function delimCloseOk(text: string, close: number, delim: string): boolean {
  if (delim === "_" || delim === "__") {
    return !isWordChar(text[close + delim.length]);
  }
  return true;
}

type Token = { elements: RichTextElement[]; next: number };

function matchEmphasis(
  text: string,
  i: number,
  base: InlineStyle,
  delims: string[],
  flag: keyof InlineStyle,
): Token | null {
  for (const d of delims) {
    if (!text.startsWith(d, i) || !delimOpenOk(text, i, d)) continue;
    const close = text.indexOf(d, i + d.length);
    if (close <= i || !delimCloseOk(text, close, d)) continue;
    const inner = text.slice(i + d.length, close);
    if (inner.trim() === "") continue;
    return {
      elements: parseInlineRichText(inner, { ...base, [flag]: true }),
      next: close + d.length,
    };
  }
  return null;
}

function matchToken(text: string, i: number, base: InlineStyle): Token | null {
  const ch = text[i];

  // インラインコード: `...`（中身は装飾しない）
  if (ch === "`") {
    const close = text.indexOf("`", i + 1);
    if (close > i) {
      const inner = text.slice(i + 1, close);
      return {
        elements: [
          withStyle({ type: "text", text: inner }, { ...base, code: true }),
        ],
        next: close + 1,
      };
    }
  }

  // リンク: [label](url)
  if (ch === "[") {
    const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(text.slice(i));
    if (m) {
      return {
        elements: [withStyle({ type: "link", url: m[2], text: m[1] }, base)],
        next: i + m[0].length,
      };
    }
  }

  return matchEmphasis(text, i, base, ["**", "__"], "bold") ??
    matchEmphasis(text, i, base, ["~~"], "strike") ??
    matchEmphasis(text, i, base, ["*", "_"], "italic");
}

export function parseInlineRichText(
  text: string,
  base: InlineStyle = {},
): RichTextElement[] {
  const out: RichTextElement[] = [];
  let plain = "";
  const flush = () => {
    if (plain !== "") {
      out.push(withStyle({ type: "text", text: plain }, base));
      plain = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const tok = matchToken(text, i, base);
    if (tok) {
      flush();
      out.push(...tok.elements);
      i = tok.next;
    } else {
      plain += text[i];
      i++;
    }
  }
  flush();
  return out;
}
