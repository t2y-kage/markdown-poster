import { assertEquals } from "@std/assert";
import {
  downloadFileText,
  enforceLengthLimit,
  MARKDOWN_MAX_LEN,
  resolveSource,
} from "./file_source.ts";

Deno.test("resolveSource: markdown only resolves to markdown", () => {
  const r = resolveSource({ markdown: "# hi", file: [] });
  assertEquals(r, { kind: "markdown", markdown: "# hi" });
});

Deno.test("resolveSource: file only resolves to first file id", () => {
  const r = resolveSource({ markdown: "", file: ["F123", "F456"] });
  assertEquals(r, { kind: "file", fileId: "F123" });
});

Deno.test("resolveSource: whitespace-only markdown counts as empty", () => {
  const r = resolveSource({ markdown: "   \n ", file: ["F123"] });
  assertEquals(r, { kind: "file", fileId: "F123" });
});

Deno.test("resolveSource: both filled is an error", () => {
  const r = resolveSource({ markdown: "# hi", file: ["F123"] });
  assertEquals(r.kind, "error");
});

Deno.test("resolveSource: neither filled is an error", () => {
  const r = resolveSource({ markdown: "  ", file: [] });
  assertEquals(r.kind, "error");
});

Deno.test("resolveSource: undefined inputs are treated as empty", () => {
  const r = resolveSource({});
  assertEquals(r.kind, "error");
});

Deno.test("enforceLengthLimit: text at the cap is accepted", () => {
  const text = "a".repeat(MARKDOWN_MAX_LEN);
  assertEquals(enforceLengthLimit(text), { ok: true, text });
});

Deno.test("enforceLengthLimit: text over the cap is rejected", () => {
  const text = "a".repeat(MARKDOWN_MAX_LEN + 1);
  const r = enforceLengthLimit(text);
  assertEquals(r.ok, false);
});

// downloadFileText: files.info の結果と fetch をモックして経路を検証する。
function mockClient(file: unknown, ok = true) {
  return {
    files: {
      // deno-lint-ignore require-await
      info: async () => ({ ok, file }),
    },
  };
}

Deno.test("downloadFileText: downloads and decodes text content", async () => {
  const client = mockClient({
    url_private_download: "https://files.slack.com/x.md",
    mimetype: "text/markdown",
  });
  let seenAuth: string | null = null;
  const fakeFetch = ((_url: string | URL, init?: RequestInit) => {
    seenAuth = new Headers(init?.headers).get("Authorization");
    return Promise.resolve(new Response("# from file"));
  }) as typeof fetch;

  const r = await downloadFileText(client, "xoxb-token", "F1", fakeFetch);
  assertEquals(r, { ok: true, text: "# from file" });
  assertEquals(seenAuth, "Bearer xoxb-token");
});

Deno.test("downloadFileText: non-text mimetype is rejected", async () => {
  const client = mockClient({
    url_private_download: "https://files.slack.com/x.png",
    mimetype: "image/png",
  });
  const r = await downloadFileText(
    client,
    "t",
    "F1",
    (() =>
      Promise.reject(new Error("should not fetch"))) as unknown as typeof fetch,
  );
  assertEquals(r.ok, false);
});

Deno.test("downloadFileText: files.info failure is reported", async () => {
  const client = mockClient(null, false);
  const r = await downloadFileText(
    client,
    "t",
    "F1",
    (() =>
      Promise.reject(new Error("should not fetch"))) as unknown as typeof fetch,
  );
  assertEquals(r.ok, false);
});
