import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PicaCodexRequests } from "@/backend/agents/acp/PicaCodexRequests";

import type { Mock } from "vitest";
import type { PicaCodexCall } from "@/backend/agents/acp/PicaCodexGlue";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";
import type {
  PicaCodexListener,
  PicaCodexTurnBinding,
} from "@/backend/agents/acp/PicaCodexRequests";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const TOOL = {
  name: "tool_a",
  description: "A tool",
  inputSchema: { type: "object" },
};
const CATALOG = [{ type: "function" as const, ...TOOL }];

type Invoke = (
  call: PicaCodexCall,
  signal: AbortSignal,
) => Promise<Pick<PicaToolOutcome, "ok"> & Partial<PicaToolOutcome>>;

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

afterEach(() => {
  vi.useRealTimers();
});

it("issues the catalog once and a policy context for codex", async () => {
  const h = harness(true);
  await expect(h.requests.catalog()).resolves.toEqual([TOOL]);
  expect(h.requests.catalogContext()).toMatch(/^[a-f0-9]{64}$/u);
  await expect(h.requests.catalog()).rejects.toThrow("Pica request refused");
});

it("issues no context without the policy", async () => {
  const h = harness(false);
  await h.requests.catalog();
  expect(h.requests.catalogContext()).toBeNull();
});

it.each([
  [[]],
  [[TOOL, TOOL]],
  [
    Array.from({ length: 513 }, (_, index) => ({
      ...TOOL,
      name: `t${index}`,
    })),
  ],
])("refuses an unsuitable catalog", async (tools) => {
  const h = harness(true, tools);
  await expect(h.requests.catalog()).rejects.toThrow("Pica catalog refused");
});

it("refuses when the listener fails", async () => {
  const h = harness(true);
  vi.mocked(h.listener.catalog).mockRejectedValueOnce(new Error("down"));
  await expect(h.requests.catalog()).rejects.toThrow("Pica catalog refused");
});

it("refuses when the session closes while the catalog loads", async () => {
  const h = harness(true);
  vi.mocked(h.listener.catalog).mockImplementationOnce(async () => {
    h.requests.close();
    return [TOOL];
  });
  await expect(h.requests.catalog()).rejects.toThrow("Pica catalog refused");
});

it("refuses without a catalog", () => {
  expect(harness(false).requests.bindThread("t1")).toBe(false);
});

it("refuses a missing or wrong context under the policy", async () => {
  const h = harness(true);
  await h.requests.catalog();
  expect(h.requests.bindThread("t1")).toBe(false);
  expect(h.requests.bindThread("t1", "c".repeat(64))).toBe(false);
});

it("refuses a context that is not hex", async () => {
  const h = harness(false);
  await h.requests.catalog();
  expect(h.requests.bindThread("t1", "nothex")).toBe(false);
});

it("refuses a second binding and an opened session", async () => {
  const h = await bound(false);
  expect(h.requests.bindThread("t2")).toBe(false);
  const other = harness(false);
  await other.requests.catalog();
  other.state.session = "x";
  expect(other.requests.bindThread("t1")).toBe(false);
});

it("refuses after close", async () => {
  const h = harness(false);
  await h.requests.catalog();
  h.requests.close();
  expect(h.requests.bindThread("t1")).toBe(false);
});

it("returns an operation with a growing sequence", async () => {
  const h = await bound(true);
  const first = h.requests.prepareTurn("t1");
  expect(first.sequence).toBe(1);
  expect(first.nonce).toMatch(/^[a-f0-9]{64}$/u);
  expect(() => h.requests.prepareTurn("t1")).toThrow("Pica turn refused");
});

it("refuses without policy, thread, prompt or a current binding", async () => {
  const plain = await bound(false);
  expect(() => plain.requests.prepareTurn("t1")).toThrow("Pica turn refused");
  const h = await bound(true);
  expect(() => h.requests.prepareTurn("other")).toThrow("Pica turn refused");
  h.state.prompting = false;
  expect(() => h.requests.prepareTurn("t1")).toThrow("Pica turn refused");
  h.state.prompting = true;
  h.state.current = false;
  expect(() => h.requests.prepareTurn("t1")).toThrow("Pica turn refused");
});

it("refuses when the sequence is exhausted", async () => {
  const h = await bound(true);
  Reflect.set(h.requests, "operationSequence", Number.MAX_SAFE_INTEGER);
  expect(() => h.requests.prepareTurn("t1")).toThrow("Pica turn refused");
});

it("refuses while a turn is active", async () => {
  const { h } = await admitted();
  expect(() => h.requests.prepareTurn("t1")).toThrow("Pica turn refused");
});

it("refuses without a prepared turn", async () => {
  const h = await bound(true);
  expect(
    h.requests.admitReady(
      ready({ operationId: "o", nonce: "n", sequence: 1 }, "c"),
    ),
  ).toBe(false);
});

it("refuses a mismatching operation, context, catalog or expiry", async () => {
  const h = await bound(true);
  const context = h.requests.catalogContext() ?? "";
  const cases: Record<string, unknown>[] = [
    { nonce: "x" },
    { operationId: "x" },
    { sequence: 99 },
    { context: "x" },
    { catalog: [] },
    { threadId: "other" },
  ];
  for (const override of cases) {
    const operation = h.requests.prepareTurn("t1");
    expect(h.requests.admitReady(ready(operation, context, override))).toBe(
      false,
    );
  }
  const operation = h.requests.prepareTurn("t1");
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 31000);
  expect(h.requests.admitReady(ready(operation, context))).toBe(false);
});

it("refuses a turn that was admitted before or ended", async () => {
  const { h, operation, context } = await admitted();
  expect(h.requests.admitReady(ready(operation, context))).toBe(false);
  await h.requests.endTurn("t1", "u1");
  const next = h.requests.prepareTurn("t1");
  expect(h.requests.admitReady(ready(next, context))).toBe(false);
});

it("refuses when the prompt stopped, the binding went stale or too many turns ended", async () => {
  const h = await bound(true);
  const context = h.requests.catalogContext() ?? "";
  let operation = h.requests.prepareTurn("t1");
  h.state.prompting = false;
  expect(h.requests.admitReady(ready(operation, context))).toBe(false);
  h.state.prompting = true;
  operation = h.requests.prepareTurn("t1");
  h.state.current = false;
  expect(h.requests.admitReady(ready(operation, context))).toBe(false);
  h.state.current = true;
  operation = h.requests.prepareTurn("t1");
  const ended = Reflect.get(h.requests, "endedTurns") as Map<string, unknown>;
  for (let index = 0; index < 4096; index += 1)
    ended.set(`e${index}`, Promise.resolve());
  expect(h.requests.admitReady(ready(operation, context))).toBe(false);
});

it("refuses when no catalog was issued", async () => {
  const { h, operation, context } = await admitted();
  await h.requests.endTurn("t1", "u1");
  const next = h.requests.prepareTurn("t1");
  Reflect.set(h.requests, "issuedCatalog", null);
  expect(h.requests.admitReady(ready(next, context, { turnId: "u2" }))).toBe(
    false,
  );
  expect(operation.sequence).toBe(1);
});

it("cancels a prepared operation", async () => {
  const h = await bound(true);
  const operation = h.requests.prepareTurn("t1");
  await expect(
    h.requests.cancelPrepare("other", operation.nonce),
  ).resolves.toBe(false);
  await expect(h.requests.cancelPrepare("t1", operation.nonce)).resolves.toBe(
    true,
  );
  await expect(h.requests.cancelPrepare("t1", operation.nonce)).resolves.toBe(
    false,
  );
});

it("ends the admitted turn of that operation", async () => {
  const { h, operation } = await admitted();
  await expect(h.requests.cancelPrepare("t1", "wrong")).resolves.toBe(false);
  await expect(h.requests.cancelPrepare("t1", operation.nonce)).resolves.toBe(
    true,
  );
  await expect(h.requests.endTurn("t1", "u1")).resolves.toBeUndefined();
});

it("refuses a request that does not match the thread, context or catalog", async () => {
  const h = await bound(true);
  const context = h.requests.catalogContext() ?? "";
  const op = h.requests.prepareTurn("t1");
  h.requests.close();
  await expect(h.requests.revokeOperation(ready(op, context))).resolves.toBe(
    false,
  );
  const g = await bound(true);
  const gOp = g.requests.prepareTurn("t1");
  await expect(g.requests.revokeOperation(ready(gOp, "wrong"))).resolves.toBe(
    false,
  );
  await expect(
    g.requests.revokeOperation(
      ready(gOp, Reflect.get(g.requests, "boundContext"), { catalog: [] }),
    ),
  ).resolves.toBe(false);
  Reflect.set(g.requests, "issuedCatalog", null);
  await expect(
    g.requests.revokeOperation(
      ready(gOp, Reflect.get(g.requests, "boundContext")),
    ),
  ).resolves.toBe(false);
});

it("revokes a prepared operation", async () => {
  const h = await bound(true);
  const context = Reflect.get(h.requests, "boundContext") as string;
  const op = h.requests.prepareTurn("t1");
  await expect(
    h.requests.revokeOperation(ready(op, context, { nonce: "x" })),
  ).resolves.toBe(false);
  await expect(h.requests.revokeOperation(ready(op, context))).resolves.toBe(
    true,
  );
});

it("matches the prepared operation field by field", async () => {
  const h = await bound(true);
  const context = Reflect.get(h.requests, "boundContext") as string;
  const op = h.requests.prepareTurn("t1");
  await expect(
    h.requests.revokeOperation(ready(op, context, { operationId: "x" })),
  ).resolves.toBe(false);
  await expect(
    h.requests.revokeOperation(ready(op, context, { sequence: 9 })),
  ).resolves.toBe(false);
});

it("revokes only the admitted operation", async () => {
  const { h, operation, context } = await admitted();
  const bad: Record<string, unknown>[] = [
    { turnId: "other" },
    { operationId: "x" },
    { nonce: "x" },
    { sequence: 9 },
  ];
  for (const override of bad)
    await expect(
      h.requests.revokeOperation(ready(operation, context, override)),
    ).resolves.toBe(false);
  await expect(
    h.requests.revokeOperation(ready(operation, context)),
  ).resolves.toBe(true);
  await expect(
    h.requests.revokeOperation(ready(operation, context)),
  ).resolves.toBe(false);
});

beforeEach(() => {
  vi.clearAllMocks();
});
