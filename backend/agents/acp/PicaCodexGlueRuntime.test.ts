import { expect, it, vi } from "vitest";

import { createPicaCodexGlue } from "@/backend/agents/acp/PicaCodexGlueRuntime.mjs";

import type { PicaCodexCall, PicaCodexGlue } from "./PicaCodexGlue";

const HEX = "b".repeat(64);
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

function build(answer: (method: string, params: unknown) => unknown): {
  readonly glue: PicaCodexGlue;
  readonly request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn(async (method: string, params: unknown) =>
    answer(method, params),
  );
  return {
    glue: createPicaCodexGlue(request),
    request,
  };
}

function call(extra: Record<string, unknown> = {}): PicaCodexCall {
  return Object.assign(
    {
      threadId: "t1",
      turnId: "u1",
      callId: "c1",
      tool: "tool_a",
      arguments: {},
    },
    extra,
  );
}

it("refuses a request that is not a function", () => {
  expect(() => createPicaCodexGlue("x")).toThrow("Pica response refused");
});

it("returns the catalog and remembers its context", async () => {
  const { glue } = build(() => ({ tools: [{ name: "a" }], context: HEX }));
  await expect(glue.policyContext()).rejects.toThrow("refused");
  await expect(glue.catalog()).resolves.toEqual([{ name: "a" }]);
  await expect(glue.policyContext()).resolves.toBe(HEX);
});

it.each([
  { tools: [], context: HEX, extra: 1 },
  { tools: "x", context: HEX },
  { tools: [], context: 5 },
  { tools: [], context: "short" },
  null,
])("refuses the malformed catalog %j", async (answer) => {
  const { glue } = build(() => answer);
  await expect(glue.catalog()).rejects.toThrow("refused");
});

it("binds a thread once with the issued context", async () => {
  let accepted: unknown = true;
  const { glue } = build((method) =>
    method.endsWith("catalog") ? { tools: [], context: HEX } : { accepted },
  );
  await glue.catalog();
  await expect(glue.bindThread("bad id", HEX)).rejects.toThrow("refused");
  await expect(glue.bindThread("t1", 5 as never)).rejects.toThrow("refused");
  await expect(glue.bindThread("t1", "c".repeat(64))).rejects.toThrow(
    "refused",
  );
  accepted = "yes";
  await expect(glue.bindThread("t1", HEX)).rejects.toThrow("refused");
  accepted = false;
  await expect(glue.bindThread("t1", HEX)).resolves.toBe(false);
  accepted = true;
  await expect(glue.bindThread("t1", HEX)).resolves.toBe(true);
  await expect(glue.policyContext()).rejects.toThrow("refused");
});

it("bindThread refuses a context that is not lowercase hex", async () => {
  const { glue } = build(() => ({ tools: [], context: HEX }));
  await expect(glue.bindThread("t1", "ZZ")).rejects.toThrow("refused");
});

it("prepares an operation and validates the answer", async () => {
  const good = { nonce: HEX, operationId: UUID, sequence: 1 };
  let answer: unknown = good;
  const { glue } = build(() => answer);
  await expect(glue.prepare("bad id")).rejects.toThrow("refused");
  await expect(glue.prepare("t1")).resolves.toEqual(good);
  const bad = [
    { ...good, extra: 1 },
    { ...good, nonce: 5 },
    { ...good, nonce: "x" },
    { ...good, operationId: 5 },
    { ...good, operationId: "short" },
    { ...good, sequence: 0.5 },
    { ...good, sequence: 0 },
  ];
  for (const value of bad) {
    answer = value;
    await expect(glue.prepare("t1")).rejects.toThrow("refused");
  }
});

it("requires accepted answers for ready and revoke", async () => {
  let answer: unknown = { accepted: true };
  const { glue } = build(() => answer);
  await expect(glue.ready({ a: 1 })).resolves.toEqual({ accepted: true });
  await expect(glue.revoke({ a: 1 })).resolves.toEqual({ accepted: true });
  for (const value of [null, { accepted: false }]) {
    answer = value;
    await expect(glue.ready({})).rejects.toThrow("refused");
    await expect(glue.revoke({})).rejects.toThrow("refused");
  }
});

it("reports whether a pending operation was cancelled", async () => {
  let answer: unknown = { cancelled: true };
  const { glue } = build(() => answer);
  await expect(glue.cancelPrepare("t1", HEX)).resolves.toBe(true);
  answer = { cancelled: false };
  await expect(glue.cancelPrepare("t1", HEX)).resolves.toBe(false);
  answer = { other: 1 };
  await expect(glue.cancelPrepare("t1", HEX)).resolves.toBe(false);
});

it("ends a turn and closes a thread on confirmation only", async () => {
  let answer: unknown = { ended: true, closed: true };
  const { glue } = build(() => answer);
  await expect(glue.endTurn("bad id", "u1")).rejects.toThrow("refused");
  await expect(glue.endTurn("t1", "bad id")).rejects.toThrow("refused");
  await expect(glue.closeThread("bad id")).rejects.toThrow("refused");
  answer = { ended: true };
  await expect(glue.endTurn("t1", "u1")).resolves.toBeUndefined();
  answer = { closed: true };
  await expect(glue.closeThread("t1")).resolves.toBeUndefined();
  answer = { ended: false, closed: false };
  await expect(glue.endTurn("t1", "u1")).rejects.toThrow("refused");
  await expect(glue.closeThread("t1")).rejects.toThrow("refused");
  answer = null;
  await expect(glue.endTurn("t1", "u1")).rejects.toThrow("refused");
  await expect(glue.closeThread("t1")).rejects.toThrow("refused");
});

it.each<unknown>([
  null,
  call({ extra: 1 }),
  call({ threadId: "bad id" }),
  call({ turnId: "bad id" }),
  call({ callId: "bad id" }),
  call({ tool: 5 }),
  call({ arguments: [] }),
])("refuses the malformed call %j", async (input) => {
  const { glue } = build(() => ({}));
  await expect(glue.dispatch(input as PicaCodexCall)).rejects.toThrow(
    "refused",
  );
});

it("returns a text result without images", async () => {
  const { glue } = build(() => ({
    success: true,
    text: "ok",
    receipt: null,
    images: [],
  }));
  await expect(glue.dispatch(call())).resolves.toEqual({
    success: true,
    text: "ok",
    images: [],
  });
});

it.each([
  { success: "x", text: "", receipt: null, images: [] },
  { success: true, text: 5, receipt: null, images: [] },
  { success: true, text: "a".repeat(1048577), receipt: null, images: [] },
  { success: true, text: "", receipt: null, images: "x" },
  { success: true, text: "", receipt: null, images: [1, 2, 3, 4, 5] },
  { success: true, text: "", receipt: UUID, images: [] },
  { success: true, text: "", receipt: null, images: [{}] },
  { success: true, text: "", receipt: 5, images: [{}] },
  { success: true, text: "", receipt: "short", images: [{}] },
  {
    success: true,
    text: "",
    receipt: UUID,
    images: [{ mimeType: "image/gif", length: 8 }],
  },
  {
    success: true,
    text: "",
    receipt: UUID,
    images: [{ mimeType: "image/png", length: 1.5 }],
  },
  {
    success: true,
    text: "",
    receipt: UUID,
    images: [{ mimeType: "image/png", length: 2 }],
  },
  {
    success: true,
    text: "",
    receipt: UUID,
    images: [{ mimeType: "image/png", length: 8000004 }],
  },
  {
    success: true,
    text: "",
    receipt: UUID,
    images: [{ mimeType: "image/png", length: 6 }],
  },
  {
    success: true,
    text: "",
    receipt: UUID,
    images: [{ mimeType: "image/png", length: 8, extra: 1 }],
  },
])("refuses the malformed result %j", async (answer) => {
  const { glue } = build(() => answer);
  await expect(glue.dispatch(call())).rejects.toThrow("refused");
});

it("reads image data in chunks", async () => {
  const head = PNG.slice(0, 8);
  const tail = PNG.slice(8);
  const { glue, request } = build((method, params) => {
    if (method.endsWith("dispatch"))
      return {
        success: true,
        text: "img",
        receipt: UUID,
        images: [{ mimeType: "image/png", length: PNG.length }],
      };
    const { offset } = params as { offset: number };
    return offset === 0
      ? { data: head, next: head.length }
      : { data: tail, next: PNG.length };
  });
  await expect(glue.dispatch(call())).resolves.toEqual({
    success: true,
    text: "img",
    images: [{ mimeType: "image/png", data: PNG }],
  });
  expect(request).toHaveBeenCalledTimes(3);
});

it.each([
  null,
  { data: "AAAA", next: 4, extra: 1 },
  { data: 5, next: 4 },
  { data: "", next: 0 },
  { data: "A".repeat(524289), next: 524289 },
  { data: "AAAA", next: 3 },
  { data: "AAAAAAAA", next: 8 },
])("refuses the malformed chunk %j", async (chunk) => {
  const { glue } = build((method) =>
    method.endsWith("dispatch")
      ? {
          success: true,
          text: "",
          receipt: UUID,
          images: [{ mimeType: "image/jpeg", length: 4 }],
        }
      : chunk,
  );
  await expect(glue.dispatch(call())).rejects.toThrow("refused");
});

it("refuses a queued call after a generation change or a full queue", async () => {
  const release: (() => void)[] = [];
  const { glue } = build((method) => {
    if (method.endsWith("dispatch"))
      return new Promise((resolve) => {
        release.push(() =>
          resolve({ success: true, text: "", receipt: null, images: [] }),
        );
      });
    return { ended: true };
  });
  const first = glue.dispatch(call());
  const second = glue.dispatch(call({ callId: "c2" }));
  const secondOutcome = expect(second).rejects.toThrow("refused");
  await vi.waitFor(() => expect(release).toHaveLength(1));
  await glue.endTurn("t1", "u1");
  release.shift()?.();
  await expect(first).resolves.toBeDefined();
  await secondOutcome;

  const queued: Promise<unknown>[] = [];
  for (let index = 0; index < 32; index += 1)
    queued.push(glue.dispatch(call({ callId: `q${index}` })).catch(() => 0));
  await expect(glue.dispatch(call({ callId: "over" }))).rejects.toThrow(
    "refused",
  );
});

it("refuses a call queued past its deadline", async () => {
  vi.useFakeTimers();
  try {
    const release: (() => void)[] = [];
    const { glue } = build(
      () =>
        new Promise((resolve) => {
          release.push(() =>
            resolve({ success: true, text: "", receipt: null, images: [] }),
          );
        }),
    );
    const first = glue.dispatch(call());
    const second = glue.dispatch(call({ callId: "c2" }));
    const outcome = expect(second).rejects.toThrow("refused");
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveLength(1);
    vi.setSystemTime(Date.now() + 61000);
    release.shift()?.();
    await first;
    await outcome;
  } finally {
    vi.useRealTimers();
  }
});
