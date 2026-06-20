import { assert, assertEquals } from "@std/assert";
import {
  pickChannelFromBody,
  pickMessageTsFromBody,
  resolveOwnedTarget,
  resolveTarget,
} from "./interaction.ts";

Deno.test("pickChannelFromBody: prefers body.channel.id", () => {
  const body = { channel: { id: "C1" }, container: { channel_id: "C2" } };
  assertEquals(pickChannelFromBody(body, "Cx"), "C1");
});

Deno.test("pickChannelFromBody: falls back to container then fallback", () => {
  assertEquals(
    pickChannelFromBody({ container: { channel_id: "C2" } }, "Cx"),
    "C2",
  );
  assertEquals(pickChannelFromBody({}, "Cx"), "Cx");
});

Deno.test("pickMessageTsFromBody: prefers container.message_ts over message.ts", () => {
  const body = { container: { message_ts: "111" }, message: { ts: "222" } };
  assertEquals(pickMessageTsFromBody(body), "111");
  assertEquals(pickMessageTsFromBody({ message: { ts: "222" } }), "222");
  assertEquals(pickMessageTsFromBody({}), undefined);
});

Deno.test("resolveTarget: returns channel/ts from payload", () => {
  const body = { channel: { id: "C1" }, message: { ts: "999" } };
  assertEquals(resolveTarget(body, { channel: "Cx" }), {
    channel: "C1",
    ts: "999",
  });
});

Deno.test("resolveTarget: returns null without a ts", () => {
  assertEquals(
    resolveTarget({ channel: { id: "C1" } }, { channel: "Cx" }),
    null,
  );
});

Deno.test("resolveOwnedTarget: returns target for the original poster", async () => {
  const body = { user: { id: "U1" }, message: { ts: "999" } };
  const target = await resolveOwnedTarget(
    body,
    { channel: "C1", submitted_by: "U1" },
    {
      chat: {
        postEphemeral: () => Promise.reject(new Error("should not notify")),
      },
    },
  );
  assertEquals(target, { channel: "C1", ts: "999" });
});

Deno.test("resolveOwnedTarget: denies a different user with an ephemeral", async () => {
  const body = { user: { id: "U2" }, message: { ts: "999" } };
  let notified = false;
  const target = await resolveOwnedTarget(
    body,
    { channel: "C1", submitted_by: "U1" },
    {
      chat: {
        // deno-lint-ignore require-await
        postEphemeral: async () => {
          notified = true;
          return { ok: true };
        },
      },
    },
  );
  assertEquals(target, null);
  assert(notified);
});
