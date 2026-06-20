// Slack のメッセージリンクから {channel, thread_ts} を取り出す。
//
// 例:
//   https://example.slack.com/archives/C01234ABCDE/p1700000000000001
//     → { channel: "C01234ABCDE", thread_ts: "1700000000.000001" }
//
// スレッド内リプライ URL には `?thread_ts=<parent_ts>` が付くため、それがあれば
// パスから抽出した ts ではなく、親 ts を採用する。

export type ThreadTarget = {
  channel: string;
  thread_ts: string;
};

const PATH_RE = /\/archives\/([A-Z0-9]+)\/p(\d+)/;
// Slack の ts は `<秒>.<マイクロ秒>` で、マイクロ秒部分は常に 6 桁。
const TS_FRACTION_DIGITS = 6;

export function parseThreadUrl(
  raw: string | undefined | null,
): ThreadTarget | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const match = parsed.pathname.match(PATH_RE);
  if (!match) return null;

  const channel = match[1];
  const tsRaw = match[2];
  if (tsRaw.length <= TS_FRACTION_DIGITS) return null;

  const integer = tsRaw.slice(0, tsRaw.length - TS_FRACTION_DIGITS);
  const fraction = tsRaw.slice(tsRaw.length - TS_FRACTION_DIGITS);
  const tsFromPath = `${integer}.${fraction}`;

  const thread_ts = parsed.searchParams.get("thread_ts") ?? tsFromPath;
  return { channel, thread_ts };
}
