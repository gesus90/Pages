import { afterEach, expect, it, vi } from "vitest";

import {
  fakeChild,
  line,
  textUpdate,
  updateOf,
} from "./runner-opencode-harness";

import type { OpenCodeAcpClient } from "@/scripts/runner/opencode.mjs";
import type { Fake, Json } from "./runner-opencode-harness";

afterEach(() => {
  vi.restoreAllMocks();
});

async function client(
  decide: (options: readonly unknown[]) => unknown = () => ({}),
  publish?: (event: unknown) => Promise<void>,
  fake: Fake = fakeChild(),
): Promise<{ fake: Fake; acp: OpenCodeAcpClient }> {
  const { OpenCodeAcpClient } = await import("@/scripts/runner/opencode.mjs");
  return { fake, acp: new OpenCodeAcpClient(fake.child, decide, publish) };
}

it("answers permission requests through the decision callback", async () => {
  const decide = vi.fn(() => ({ outcome: "selected", optionId: "once" }));
  const { fake } = await client(decide);
  const options = [{ optionId: "once", kind: "allow_once" }];
  fake.stdout.write(
    line({
      jsonrpc: "2.0",
      id: 41,
      method: "session/request_permission",
      params: { options },
    }),
  );
  fake.stdout.write(
    line({
      jsonrpc: "2.0",
      id: 42,
      method: "session/request_permission",
    }),
  );
  await vi.waitFor(() => expect(fake.sent).toHaveLength(2));
  expect(decide).toHaveBeenNthCalledWith(1, options);
  expect(decide).toHaveBeenNthCalledWith(2, []);
  expect(fake.sent[0]).toEqual({
    jsonrpc: "2.0",
    id: 41,
    result: { outcome: { outcome: "selected", optionId: "once" } },
  });
});

it("refuses unsupported methods and ignores notifications and stray responses", async () => {
  const { fake } = await client();
  fake.stdout.write(
    line({ jsonrpc: "2.0", id: "x", method: "fs/read_text_file" }),
  );
  fake.stdout.write(line({ jsonrpc: "2.0", method: "unknown/notice" }));
  fake.stdout.write(line({ jsonrpc: "2.0", id: 99, result: {} }));
  await vi.waitFor(() => expect(fake.sent).toHaveLength(2));
  expect(fake.sent[0]).toEqual({
    jsonrpc: "2.0",
    id: "x",
    error: { code: -32601, message: "Method not supported" },
  });
  expect(fake.sent[1]).toMatchObject({ id: 99, error: { code: -32601 } });
});

it("rejects a request with the stable error shape of an ACP refusal", async () => {
  const { fake, acp } = await client();
  const first = acp.call("session/new", {});
  const second = acp.call("session/new", {});
  fake.stdout.write(
    line({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "429 slow down", data: { a: 1 } },
    }),
  );
  fake.stdout.write(line({ jsonrpc: "2.0", id: 2, error: undefined }));
  await expect(first).rejects.toMatchObject({
    message: "OpenCode ACP request failed",
    acpCode: -32000,
    acpText: '429 slow down {"a":1}',
  });
  await expect(second).resolves.toBeUndefined();
  const third = acp.call("session/new", {});
  fake.stdout.write(line({ jsonrpc: "2.0", id: 3, error: {} }));
  await expect(third).rejects.toMatchObject({ acpText: " {}" });
});

it("projects each complete message once at its boundary and never publishes thoughts", async () => {
  const publish = vi.fn(async () => undefined);
  const { fake, acp } = await client(() => ({}), publish);
  fake.stdout.write(line(textUpdate("one ", "m1")));
  fake.stdout.write(line(textUpdate("more", "m1")));
  fake.stdout.write(line(updateOf("agent_thought_chunk")));
  fake.stdout.write(line(textUpdate("two", "m2")));
  fake.stdout.write(line(textUpdate("!", "m3")));
  fake.stdout.write(line(updateOf("plan")));
  fake.stdout.write(
    line({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "image" },
        },
      },
    }),
  );
  fake.stdout.write(line({ jsonrpc: "2.0", method: "session/update" }));
  await vi.waitFor(() =>
    expect(publish.mock.calls.length).toBeGreaterThanOrEqual(10),
  );
  const events = (publish.mock.calls as unknown as [{ update?: Json }][]).map(
    ([event]) => event.update,
  );
  const messages = events
    .filter((update) => update?.sessionUpdate === "agent_message")
    .map((update) => update?.text);
  expect(messages).toEqual(["one more", "two", "!"]);
  expect(
    events.some((update) => update?.sessionUpdate === "agent_thought_chunk"),
  ).toBe(false);
  expect(acp.text).toBe("");
  await acp.flushMessage();
  expect(messages).toHaveLength(3);
});

it("starts the next unnamed message from empty text and keeps working without a publisher", async () => {
  const { fake, acp } = await client();
  fake.stdout.write(line(textUpdate("first")));
  await vi.waitFor(() => expect(acp.text).toBe("first"));
  fake.stdout.write(line(textUpdate(" same")));
  await vi.waitFor(() => expect(acp.text).toBe("first same"));
  await acp.flushMessage();
  fake.stdout.write(line(textUpdate("second")));
  await vi.waitFor(() => expect(acp.text).toBe("second"));
  await expect(acp.flushMessage()).resolves.toBeUndefined();
});

it("refuses to write an ACP request above one MiB and keeps the failure", async () => {
  const { acp } = await client();
  await expect(
    acp.call("session/prompt", { text: "x".repeat(1048576) }),
  ).rejects.toThrow("ACP input exceeds 1 MiB");
  await expect(acp.call("initialize", {})).rejects.toThrow(
    "ACP input exceeds 1 MiB",
  );
});

it("fails the request when the input stream refuses the write", async () => {
  const { acp } = await client(
    undefined,
    undefined,
    fakeChild(undefined, new Error("broken pipe")),
  );
  await expect(acp.call("initialize", {})).rejects.toThrow("broken pipe");
});

it("fails open requests when the child reports an error or ends", async () => {
  const first = await client();
  const pending = first.acp.call("initialize", {});
  first.fake.child.emit("error", new Error("spawn failed"));
  await expect(pending).rejects.toThrow("spawn failed");
  await expect(first.acp.call("initialize", {})).rejects.toThrow(
    "spawn failed",
  );
  const second = await client();
  const ended = second.acp.call("initialize", {});
  second.fake.child.emit("close");
  await expect(ended).rejects.toThrow("OpenCode ACP ended");
});

it("kills the child and fails when the output is not JSON", async () => {
  const { fake, acp } = await client();
  const pending = acp.call("initialize", {});
  fake.stdout.write("this is not json\n");
  await expect(pending).rejects.toBeInstanceOf(SyntaxError);
  expect(fake.child.kill).toHaveBeenCalledWith("SIGKILL");
});

it("handles a trailing line without a newline at the end of the stream", async () => {
  const { fake, acp } = await client();
  const pending = acp.call("initialize", {});
  fake.stdout.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { a: 1 } }));
  await expect(pending).resolves.toEqual({ a: 1 });
});
