import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PicaCodexRequests } from "@/backend/agents/acp/PicaCodexRequests";

import type { Mock } from "vitest";
import type { PicaCodexCall } from "@/backend/agents/acp/PicaCodexGlue";
import type {
  PicaCodexListener,
  PicaCodexTurnBinding,
} from "@/backend/agents/acp/PicaCodexRequests";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
const TOOL = {
  name: "tool_a",
  description: "A tool",
  inputSchema: { type: "object" },
};
const CATALOG = [{ type: "function" as const, ...TOOL }];

type Answer = Pick<PicaToolOutcome, "ok"> & Partial<PicaToolOutcome>;

type Invoke = (call: PicaCodexCall, signal: AbortSignal) => Promise<Answer>;

interface Harness {
  readonly requests: PicaCodexRequests;
  readonly binding: PicaCodexTurnBinding;
  readonly state: {
    current: boolean;
    session: string | null;
    prompting: boolean;
  };
  readonly invoke: Mock<Invoke>;
  readonly listener: PicaCodexListener;
}

function harness(requirePolicy: boolean, tools = [TOOL]): Harness {
  const state = {
    current: true,
    session: null as string | null,
    prompting: true,
  };
  const invoke = vi.fn<Invoke>(async () => ({ ok: true, result: "done" }));
  const binding: PicaCodexTurnBinding = {
    isCurrent: () => state.current,
    invoke: async (call, abort) => ({
      result: null,
      error: null,
      ...(await invoke(call, abort)),
    }),
  };
  const listener: PicaCodexListener = {
    catalog: vi.fn(async () => tools),
    capture: vi.fn(() => binding),
  };
  const requests = new PicaCodexRequests({
    listener,
    requirePolicy,
    session: () => state.session,
    prompting: () => state.prompting,
  });
  return { requests, binding, state, invoke, listener };
}

/** Issues the catalog and binds thread `t1`, as a session does at start. */
async function bound(requirePolicy: boolean): Promise<Harness> {
  const h = harness(requirePolicy);
  await h.requests.catalog();
  expect(
    h.requests.bindThread("t1", h.requests.catalogContext() ?? undefined),
  ).toBe(true);
  h.state.session = "t1";
  return h;
}

/** Admits a policy turn `u1` and returns its operation identity. */
async function admitted(): Promise<{
  readonly h: Harness;
  readonly operation: { operationId: string; nonce: string; sequence: number };
  readonly context: string;
}> {
  const h = harness(true);
  await h.requests.catalog();
  const context = h.requests.catalogContext() ?? "";
  h.requests.bindThread("t1", context);
  h.state.session = "t1";
  const operation = h.requests.prepareTurn("t1");
  expect(h.requests.admitReady(ready(operation, context))).toBe(true);
  return { h, operation, context };
}

type ReadyInput = Parameters<PicaCodexRequests["admitReady"]>[0];
type ChunkInput = Parameters<PicaCodexRequests["chunk"]>[0];

function ready(
  operation: { operationId: string; nonce: string; sequence: number },
  context: string,
  overrides: Record<string, unknown> = {},
): ReadyInput {
  return Object.assign(
    {
      requestId: "r1",
      threadId: "t1",
      turnId: "u1",
      context,
      catalog: CATALOG,
    },
    operation,
    overrides,
  );
}

function callOf(
  extra: Partial<PicaCodexCall> = {},
  operation?: { operationId: string; nonce: string; sequence: number },
): PicaCodexCall {
  return {
    threadId: "t1",
    turnId: "u1",
    callId: "c1",
    tool: "tool_a",
    arguments: {},
    ...operation,
    ...extra,
  };
}

const signal = (): AbortSignal => new AbortController().signal;
afterEach(() => {
  vi.useRealTimers();
});
it("captures a turn without the policy", async () => {
  const h = await bound(false);
  expect(h.requests.bindTurn("t1", "u1")).toBe(true);
  expect(h.requests.bindTurn("t1", "u2")).toBe(false);
});

it("refuses under the policy, another thread, no prompt or a stale binding", async () => {
  const policy = await bound(true);
  expect(policy.requests.bindTurn("t1", "u1")).toBe(false);
  const h = await bound(false);
  expect(h.requests.bindTurn("other", "u1")).toBe(false);
  h.state.prompting = false;
  expect(h.requests.bindTurn("t1", "u1")).toBe(false);
  h.state.prompting = true;
  h.state.current = false;
  expect(h.requests.bindTurn("t1", "u1")).toBe(false);
});

it("refuses an ended turn and a full ended list", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  await h.requests.endTurn("t1", "u1");
  expect(h.requests.bindTurn("t1", "u1")).toBe(false);
  const ended = Reflect.get(h.requests, "endedTurns") as Map<string, unknown>;
  for (let index = 0; index < 4096; index += 1)
    ended.set(`e${index}`, Promise.resolve());
  expect(h.requests.bindTurn("t1", "u9")).toBe(false);
});

it("returns the text of a successful tool", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  await expect(h.requests.dispatch(callOf(), signal())).resolves.toEqual({
    success: true,
    text: "done",
    receipt: null,
    images: [],
  });
});

it("returns defaults for empty results and failures", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  h.invoke.mockResolvedValueOnce({ ok: true });
  await expect(h.requests.dispatch(callOf(), signal())).resolves.toMatchObject({
    text: "",
  });
  h.invoke.mockResolvedValueOnce({ ok: false });
  await expect(
    h.requests.dispatch(callOf({ callId: "c2" }), signal()),
  ).resolves.toMatchObject({ success: false, text: "FAILED" });
  h.invoke.mockResolvedValueOnce({ ok: false, error: "bad" });
  await expect(
    h.requests.dispatch(callOf({ callId: "c3" }), signal()),
  ).resolves.toMatchObject({ text: "bad" });
});

it("refuses without a turn or with an aborted signal", async () => {
  const h = await bound(false);
  await expect(h.requests.dispatch(callOf(), signal())).rejects.toThrow(
    "Pica turn refused",
  );
  h.requests.bindTurn("t1", "u1");
  const controller = new AbortController();
  controller.abort();
  await expect(
    h.requests.dispatch(callOf(), controller.signal),
  ).rejects.toThrow();
});

it("refuses unknown tools, repeated calls, big arguments and operation mismatches", async () => {
  const { h, operation } = await admitted();
  const ok = (extra: Partial<PicaCodexCall>): PicaCodexCall =>
    callOf(extra, operation);
  await expect(
    h.requests.dispatch(ok({ tool: "unknown" }), signal()),
  ).rejects.toThrow("Pica call refused");
  await expect(
    h.requests.dispatch(
      ok({ arguments: { big: "a".repeat(1024 * 1024) } }),
      signal(),
    ),
  ).rejects.toThrow("Pica call refused");
  await expect(
    h.requests.dispatch(ok({ operationId: "x" }), signal()),
  ).rejects.toThrow("Pica call refused");
  await expect(
    h.requests.dispatch(ok({ nonce: "x" }), signal()),
  ).rejects.toThrow("Pica call refused");
  await expect(
    h.requests.dispatch(ok({ sequence: 99 }), signal()),
  ).rejects.toThrow("Pica call refused");
  await h.requests.dispatch(ok({}), signal());
  await expect(h.requests.dispatch(ok({}), signal())).rejects.toThrow(
    "Pica call refused",
  );
});

it("refuses a call while another is pending or after 4096 calls", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  let finish: (value: Answer) => void = () => undefined;
  h.invoke.mockImplementationOnce(
    () =>
      new Promise<Answer>((resolve) => {
        finish = resolve;
      }),
  );
  const first = h.requests.dispatch(callOf(), signal());
  await expect(
    h.requests.dispatch(callOf({ callId: "c2" }), signal()),
  ).rejects.toThrow("Pica call refused");
  finish({ ok: true });
  await first;
  const turn = Reflect.get(h.requests, "turn") as { calls: Set<string> };
  for (let index = 0; index < 4096; index += 1) turn.calls.add(`x${index}`);
  await expect(
    h.requests.dispatch(callOf({ callId: "c9" }), signal()),
  ).rejects.toThrow("Pica call refused");
});

it("refuses invalid images and too many images", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  h.invoke.mockResolvedValueOnce({
    ok: true,
    images: [{ mimeType: "image/png", data: "bad!" }],
  });
  await expect(h.requests.dispatch(callOf(), signal())).rejects.toThrow(
    "Pica call refused",
  );
  const image = { mimeType: "image/png" as const, data: PNG };
  h.invoke.mockResolvedValueOnce({
    ok: true,
    images: [image, image, image, image, image],
  });
  await expect(
    h.requests.dispatch(callOf({ callId: "c2" }), signal()),
  ).rejects.toThrow("Pica call refused");
});

it("refuses an answer when the turn ended meanwhile", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  let finish: (value: Answer) => void = () => undefined;
  h.invoke.mockImplementationOnce(
    () =>
      new Promise<Answer>((resolve) => {
        finish = resolve;
      }),
  );
  const outcome = h.requests.dispatch(callOf(), signal());
  const check = expect(outcome).rejects.toThrow("Pica call refused");
  h.requests.bindTurn("t1", "u2");
  const ended = h.requests.endTurn("t1", "u1");
  finish({ ok: true });
  await check;
  await ended;
});

it("refuses an answer when another turn replaced it", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  let finish: (value: Answer) => void = () => undefined;
  h.invoke.mockImplementationOnce(
    () =>
      new Promise<Answer>((resolve) => {
        finish = resolve;
      }),
  );
  const outcome = h.requests.dispatch(callOf(), signal());
  const check = expect(outcome).rejects.toThrow("Pica call refused");
  Reflect.set(h.requests, "turn", {
    ...(Reflect.get(h.requests, "turn") as object),
  });
  finish({ ok: true });
  await check;
});

it("refuses when the signal aborts during the call", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  const controller = new AbortController();
  h.invoke.mockImplementationOnce(async () => {
    controller.abort();
    return { ok: true };
  });
  await expect(
    h.requests.dispatch(callOf(), controller.signal),
  ).rejects.toThrow("Pica call refused");
});

function chunkOf(
  extra: Record<string, unknown> = {},
  operation?: { operationId: string; nonce: string; sequence: number },
): ChunkInput {
  return Object.assign(
    {
      threadId: "t1",
      turnId: "u1",
      callId: "c1",
      receipt: "r",
      image: 0,
      offset: 0,
    },
    operation,
    extra,
  );
}

async function withImages(
  images: { mimeType: "image/png"; data: string }[],
): Promise<{ h: Harness; receipt: string }> {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  h.invoke.mockResolvedValueOnce({ ok: true, images });
  const answer = (await h.requests.dispatch(callOf(), signal())) as {
    receipt: string;
  };
  return { h, receipt: answer.receipt };
}

it("streams an image in bounded portions and then drops the receipt", async () => {
  const big = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(600 * 1024),
  ]).toString("base64");
  const small = { mimeType: "image/png" as const, data: PNG };
  const { h, receipt } = await withImages([
    { mimeType: "image/png", data: big },
    small,
  ]);
  const first = h.requests.chunk(chunkOf({ receipt }));
  expect(first.next).toBe(512 * 1024);
  const second = h.requests.chunk(chunkOf({ receipt, offset: first.next }));
  expect(second.next).toBe(big.length);
  const third = h.requests.chunk(chunkOf({ receipt, image: 1 }));
  expect(third.data).toBe(PNG);
  expect(() => h.requests.chunk(chunkOf({ receipt, image: 1 }))).toThrow(
    "Pica receipt refused",
  );
});

it("refuses a wrong receipt, call, position or an expired receipt", async () => {
  const { h, receipt } = await withImages([
    { mimeType: "image/png", data: PNG },
  ]);
  for (const override of [
    { receipt: "other" },
    { callId: "other" },
    { image: 1 },
    { offset: 4 },
  ])
    expect(() => h.requests.chunk(chunkOf({ receipt, ...override }))).toThrow(
      "Pica receipt refused",
    );
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 31000);
  expect(() => h.requests.chunk(chunkOf({ receipt }))).toThrow(
    "Pica receipt refused",
  );
});

it("refuses without a receipt or without the image", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  expect(() => h.requests.chunk(chunkOf())).toThrow("Pica receipt refused");
  const { h: g, receipt } = await withImages([
    { mimeType: "image/png", data: PNG },
  ]);
  const turn = Reflect.get(g.requests, "turn") as {
    receipt: { images: unknown[] };
  };
  turn.receipt.images.length = 0;
  expect(() => g.requests.chunk(chunkOf({ receipt }))).toThrow(
    "Pica receipt refused",
  );
});

it("checks the operation identity under the policy", async () => {
  const { h, operation } = await admitted();
  h.invoke.mockResolvedValueOnce({
    ok: true,
    images: [{ mimeType: "image/png", data: PNG }],
  });
  const answer = (await h.requests.dispatch(
    callOf({}, operation),
    signal(),
  )) as { receipt: string };
  expect(() =>
    h.requests.chunk(chunkOf({ receipt: answer.receipt, nonce: "x" })),
  ).toThrow("Pica receipt refused");
  expect(
    h.requests.chunk(chunkOf({ receipt: answer.receipt }, operation)).data,
  ).toBe(PNG);
});

it("expires the receipt by timer", async () => {
  vi.useFakeTimers();
  const { h, receipt } = await withImages([
    { mimeType: "image/png", data: PNG },
  ]);
  vi.advanceTimersByTime(31000);
  expect(() => h.requests.chunk(chunkOf({ receipt }))).toThrow(
    "Pica receipt refused",
  );
});

it("keeps a newer receipt when an older timer fires", async () => {
  vi.useFakeTimers();
  const { h, receipt } = await withImages([
    { mimeType: "image/png", data: PNG },
  ]);
  const turn = Reflect.get(h.requests, "turn") as {
    receipt: { id: string } | null;
  };
  const kept = turn.receipt;
  if (kept) turn.receipt = { ...kept, id: "newer" };
  vi.advanceTimersByTime(31000);
  expect(turn.receipt?.id).toBe("newer");
  expect(receipt).toBeDefined();
});

it("ends a turn and waits for its pending call", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  let finish: (value: Answer) => void = () => undefined;
  h.invoke.mockImplementationOnce(
    () =>
      new Promise<Answer>((resolve) => {
        finish = resolve;
      }),
  );
  const call = h.requests.dispatch(callOf(), signal());
  const check = expect(call).rejects.toThrow("Pica call refused");
  const ended = h.requests.endTurn("t1", "u1");
  finish({ ok: true });
  await ended;
  await check;
  await h.requests.endTurn("t1", "u1");
});

it("refuses to end an unknown turn", async () => {
  const h = await bound(false);
  await expect(h.requests.endTurn("t1", "u1")).rejects.toThrow(
    "Pica turn refused",
  );
  h.requests.bindTurn("t1", "u1");
  await expect(h.requests.endTurn("other", "u1")).rejects.toThrow(
    "Pica turn refused",
  );
  await expect(h.requests.endTurn("t1", "u2")).rejects.toThrow(
    "Pica turn refused",
  );
});

it("closes the thread, ending its turn, and is idempotent", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  await expect(h.requests.closeThread("other")).rejects.toThrow(
    "Pica thread refused",
  );
  const first = h.requests.closeThread("t1");
  const second = h.requests.closeThread("t1");
  await Promise.all([first, second]);
  await h.requests.closeThread("t1");
  await h.requests.endTurn("t1", "u1");
  expect(() => h.requests.confirmThread("t1")).toThrow("Pica thread refused");
});

it("closes a thread without a turn and tolerates a missing close task", async () => {
  const h = await bound(false);
  await h.requests.closeThread("t1");
  Reflect.set(h.requests, "closeTask", null);
  await h.requests.closeThread("t1");
});

it("close revokes the turn and its receipt", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  h.invoke.mockResolvedValueOnce({
    ok: true,
    images: [{ mimeType: "image/png", data: PNG }],
  });
  await h.requests.dispatch(callOf(), signal());
  h.requests.close();
  expect(() => h.requests.confirmThread("t1")).toThrow("Pica thread refused");
  h.requests.close();
});

it("cancelTurn ends the current turn when there is one", async () => {
  const h = await bound(false);
  await h.requests.cancelTurn();
  h.requests.bindTurn("t1", "u1");
  await h.requests.cancelTurn();
  expect(h.requests.bindTurn("t1", "u1")).toBe(false);
});

it("cancelTurn drops a prepared operation", async () => {
  const h = await bound(true);
  h.requests.prepareTurn("t1");
  await h.requests.cancelTurn();
  expect(() => h.requests.prepareTurn("t1")).not.toThrow();
});

it("cancelTurn skips an unbound thread", async () => {
  const h = await bound(false);
  h.requests.bindTurn("t1", "u1");
  Reflect.set(h.requests, "threadId", null);
  await h.requests.cancelTurn();
});

it("confirms the bound thread", async () => {
  const h = await bound(false);
  expect(() => h.requests.confirmThread("t1")).not.toThrow();
});

beforeEach(() => {
  vi.clearAllMocks();
});
