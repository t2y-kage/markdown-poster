import { assertEquals } from "@std/assert";
import { parseThreadUrl } from "./thread_url.ts";

Deno.test("parseThreadUrl: top-level message URL", () => {
  const url =
    "https://example.slack.com/archives/C01234ABCDE/p1700000000000001";
  assertEquals(parseThreadUrl(url), {
    channel: "C01234ABCDE",
    thread_ts: "1700000000.000001",
  });
});

Deno.test("parseThreadUrl: thread reply URL uses parent ts from query param", () => {
  const url =
    "https://example.slack.com/archives/C01234ABCDE/p1700000999999999?thread_ts=1700000000.000001&cid=C01234ABCDE";
  assertEquals(parseThreadUrl(url), {
    channel: "C01234ABCDE",
    thread_ts: "1700000000.000001",
  });
});

Deno.test("parseThreadUrl: leading/trailing whitespace is trimmed", () => {
  const url =
    "  https://example.slack.com/archives/C01234ABCDE/p1700000000000001  ";
  assertEquals(parseThreadUrl(url), {
    channel: "C01234ABCDE",
    thread_ts: "1700000000.000001",
  });
});

Deno.test("parseThreadUrl: empty or nullish input returns null", () => {
  assertEquals(parseThreadUrl(""), null);
  assertEquals(parseThreadUrl("   "), null);
  assertEquals(parseThreadUrl(null), null);
  assertEquals(parseThreadUrl(undefined), null);
});

Deno.test("parseThreadUrl: non-Slack URL returns null", () => {
  assertEquals(parseThreadUrl("https://example.com/foo/bar"), null);
  assertEquals(parseThreadUrl("not a url at all"), null);
});

Deno.test("parseThreadUrl: URL without /archives/ path returns null", () => {
  assertEquals(
    parseThreadUrl("https://example.slack.com/team/U01234"),
    null,
  );
});
