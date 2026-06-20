import { assert, assertEquals } from "@std/assert";
import {
  buildEditModalView,
  parseEditMeta,
  readMarkdownInput,
} from "./edit_modal.ts";

Deno.test("parseEditMeta: parses a complete meta object", () => {
  const raw = JSON.stringify({ channel: "C1", ts: "999", posted_by: "U1" });
  assertEquals(parseEditMeta(raw), {
    channel: "C1",
    ts: "999",
    posted_by: "U1",
  });
});

Deno.test("parseEditMeta: rejects a meta missing posted_by", () => {
  const raw = JSON.stringify({ channel: "C1", ts: "999" });
  assertEquals(parseEditMeta(raw), null);
});

Deno.test("parseEditMeta: returns null for invalid JSON or undefined", () => {
  assertEquals(parseEditMeta("not json"), null);
  assertEquals(parseEditMeta(undefined), null);
});

Deno.test("readMarkdownInput: extracts the value from view state", () => {
  const view = {
    state: {
      values: {
        markdown_input_block: { markdown_input: { value: "# hi" } },
      },
    },
  };
  assertEquals(readMarkdownInput(view), "# hi");
});

Deno.test("readMarkdownInput: returns empty string when absent", () => {
  assertEquals(readMarkdownInput({}), "");
  assertEquals(readMarkdownInput({ state: { values: {} } }), "");
});

Deno.test("buildEditModalView: embeds meta in private_metadata and caps input length", () => {
  const meta = { channel: "C1", ts: "999", posted_by: "U1" };
  const view = buildEditModalView(meta, "# hi") as {
    private_metadata: string;
    blocks: Array<{ element: { initial_value: string; max_length: number } }>;
  };
  assertEquals(JSON.parse(view.private_metadata), meta);
  assertEquals(view.blocks[0].element.initial_value, "# hi");
  assert(view.blocks[0].element.max_length <= 3000);
});
