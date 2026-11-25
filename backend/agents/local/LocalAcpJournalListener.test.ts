import { expect, it, vi } from "vitest";

import type { Mock, MockInstance } from "vitest";

import { LocalAcpJournalListener } from "@/backend/agents/local/LocalAcpJournalListener";
import { LocalSessionJournal } from "@/backend/agents/local/LocalSessionJournal";
import { AgentSessionRecorder } from "@/backend/service/agents/sessions/AgentSessionRecorder";

import type { LocalSessionMutation } from "@/backend/agents/local/LocalSessionContracts";

const order: string[] = [];

type ProjectedName =
  | "announced"
  | "update"
  | "openCodeMessages"
  | "antigravityCalls"
  | "prompted"
  | "claudeUsage"
  | "closed"
  | "drained";

function blankRecorder(): AgentSessionRecorder {
  const value: unknown = Object.create(AgentSessionRecorder.prototype);
  if (!(value instanceof AgentSessionRecorder)) throw new Error("no recorder");
  return value;
}

function blankJournal(): LocalSessionJournal {
  const value: unknown = Object.create(LocalSessionJournal.prototype);
  if (!(value instanceof LocalSessionJournal)) throw new Error("no journal");
  return value;
}

function createFixture(): {
  readonly listener: LocalAcpJournalListener;
  readonly projections: {
    readonly [Name in ProjectedName]: Mock<AgentSessionRecorder[Name]>;
  };
  readonly append: MockInstance<LocalSessionJournal["append"]>;
} {
  const recorder = blankRecorder();
  const projections = {
    announced: vi.fn<AgentSessionRecorder["announced"]>(() => {
      order.push("announced");
    }),
    update: vi.fn<AgentSessionRecorder["update"]>(() => {
      order.push("update");
    }),
    openCodeMessages: vi.fn<AgentSessionRecorder["openCodeMessages"]>(),
    antigravityCalls: vi.fn<AgentSessionRecorder["antigravityCalls"]>(),
    prompted: vi.fn<AgentSessionRecorder["prompted"]>(),
    claudeUsage: vi.fn<AgentSessionRecorder["claudeUsage"]>(),
    closed: vi.fn<AgentSessionRecorder["closed"]>(),
    drained: vi.fn<AgentSessionRecorder["drained"]>(async () => undefined),
  };
  for (const [name, value] of Object.entries(projections))
    Object.defineProperty(recorder, name, { value });
  Object.defineProperty(recorder, "current", {
    value: { key: { attemptId: "attempt-1" } },
  });
  const journal = blankJournal();
  const append = vi.spyOn(journal, "append").mockImplementation(async () => {
    order.push("append");
    return { sequence: 1, previousDigest: "", digest: "", payload: "" };
  });
  return {
    listener: new LocalAcpJournalListener(recorder, journal),
    projections,
    append,
  };
}

function channels(append: {
  readonly mock: { readonly calls: readonly [LocalSessionMutation][] };
}): string[] {
  return append.mock.calls.map(([record]) =>
    record.kind === "frame" ? record.channel : record.kind,
  );
}

it("journals each native frame before projecting it", async () => {
  order.length = 0;
  const { listener, projections, append } = createFixture();
  listener.announced(undefined);
  listener.announced({ loadSession: true });
  listener.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "hi" },
  });
  listener.prompted(null);
  listener.prompted(
    { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    true,
    "n",
  );
  listener.claudeUsage({ sessionId: "s", id: "i", kind: "total", models: [] });
  listener.closed();
  await listener.drained();
  expect(channels(append)).toEqual([
    "announced",
    "announced",
    "update",
    "prompted",
    "prompted",
    "claudeUsage",
    "closed",
  ]);
  expect(append.mock.calls[0]?.[0]).toEqual({
    kind: "frame",
    attemptId: "attempt-1",
    channel: "announced",
    body: "null",
  });
  expect(projections.prompted).toHaveBeenLastCalledWith(
    { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    true,
    "n",
  );
  expect(order.slice(0, 2)).toEqual(["append", "announced"]);
});

it("persists OpenCode messages without a frame", async () => {
  const { listener, projections, append } = createFixture();
  listener.openCodeMessages([], "/pricing", null, { a: "b" });
  await listener.drained();
  expect(projections.openCodeMessages).toHaveBeenCalledWith(
    [],
    "/pricing",
    null,
    {
      a: "b",
    },
  );
  expect(append).not.toHaveBeenCalled();
});

it("keeps the first journal failure after later frames succeeded", async () => {
  const { listener, projections, append } = createFixture();
  const first = new Error("first");
  append.mockRejectedValueOnce(first).mockRejectedValueOnce(new Error("later"));
  listener.closed();
  listener.closed();
  listener.closed();
  await expect(listener.drained()).rejects.toBe(first);
  expect(projections.closed).toHaveBeenCalledOnce();
});

it("keeps the first OpenCode failure after a later message succeeded", async () => {
  const { listener, projections } = createFixture();
  const first = new Error("first");
  projections.openCodeMessages
    .mockImplementationOnce(() => {
      throw first;
    })
    .mockImplementationOnce(() => {
      throw new Error("later");
    });
  listener.openCodeMessages([], "/pricing", null, {});
  listener.openCodeMessages([], "/pricing", null, {});
  listener.openCodeMessages([], "/pricing", null, {});
  await expect(listener.drained()).rejects.toBe(first);
});

it("propagates a failed OpenCode projection", async () => {
  const { listener, projections } = createFixture();
  const failure = new Error("projection");
  projections.drained.mockRejectedValueOnce(failure);
  listener.openCodeMessages([], "/pricing", "free", {});
  await expect(listener.drained()).rejects.toBe(failure);
});

it("persists Antigravity calls in order without a frame", async () => {
  const { listener, projections, append } = createFixture();
  const calls = {
    calls: 2,
    inputTokens: 3,
    outputTokens: 4,
    cacheReadTokens: 5,
  };
  listener.antigravityCalls(calls);
  await listener.drained();
  expect(projections.antigravityCalls).toHaveBeenCalledWith(calls);
  expect(append).not.toHaveBeenCalled();
});

it("keeps the first Antigravity failure after a later call succeeded", async () => {
  const { listener, projections } = createFixture();
  const first = new Error("first");
  projections.antigravityCalls
    .mockImplementationOnce(() => {
      throw first;
    })
    .mockImplementationOnce(() => {
      throw new Error("later");
    });
  const calls = {
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };
  listener.antigravityCalls(calls);
  listener.antigravityCalls(calls);
  listener.antigravityCalls(calls);
  await expect(listener.drained()).rejects.toBe(first);
});
