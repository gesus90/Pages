import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PicaAcpSessionPool } from "@/backend/service/chat/acp/PicaAcpSessionPool";

import {
  closed,
  completedTurn,
  deferred,
} from "../../agents/page81-resource-fixture";

import type { AcpSessionListener } from "@/backend/agents/acp/AcpChat";
import type {
  PlanSession,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type {
  PicaAcpPoolOpening,
  PicaAcpPoolSession,
  PicaAcpPoolStart,
} from "@/backend/service/chat/acp/PicaAcpSessionPool";
import type { PicaBridgeMcpChannel } from "@/backend/service/chat/acp/PicaBridge";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";

const GROUP: PicaAcpPoolSession = {
  chatSessionId: "chat-session-group",
  agentId: "agent-1",
  agentName: "Ed",
  conversation: "Gruppe „A-Team“",
  fingerprint: "configuration-1",
};

interface FakeNative extends PlanSession {
  readonly next: ReturnType<typeof vi.fn<NonNullable<PlanSession["next"]>>>;
  readonly close: ReturnType<typeof vi.fn<PlanSession["close"]>>;
  readonly steer: ReturnType<typeof vi.fn<NonNullable<PlanSession["steer"]>>>;
  readonly end: () => void;
}

/** A native session whose process ends on close or on `end`, like an ACP worker. */
function fakeNative(turn: Promise<PlanSessionTurn>): FakeNative {
  const exited = deferred<undefined>();
  return {
    turn,
    terminated: exited.promise.then(() => undefined),
    next: vi.fn(async () => completedTurn()),
    steer: vi.fn(async () => "injected" as const),
    close: vi.fn(async () => {
      exited.resolve(undefined);
      return closed();
    }),
    end: () => exited.resolve(undefined),
  };
}

function listener(): AcpSessionListener & {
  readonly initialized: ReturnType<
    typeof vi.fn<NonNullable<AcpSessionListener["initialized"]>>
  >;
  readonly update: ReturnType<typeof vi.fn<AcpSessionListener["update"]>>;
} {
  return {
    initialized: vi.fn<NonNullable<AcpSessionListener["initialized"]>>(),
    update: vi.fn<AcpSessionListener["update"]>(),
    prompted: vi.fn(),
    closed: vi.fn(),
  };
}

/** The pool hands the turn on unread, so its identity is all a test needs. */
function turnInput(): AgentPlanExecutionInput {
  const input: unknown = { prompt: "next round", directory: "/workspace" };
  return input as AgentPlanExecutionInput;
}

const TURN_INPUT = turnInput();

function world(idleMinutes = 10): {
  readonly pool: PicaAcpSessionPool;
  readonly natives: FakeNative[];
  readonly starts: PicaAcpPoolStart[];
  readonly open: (
    overrides?: Partial<PicaAcpPoolOpening>,
  ) => Promise<PlanSession>;
} {
  const natives: FakeNative[] = [];
  const starts: PicaAcpPoolStart[] = [];
  const pool = new PicaAcpSessionPool({
    idleMinutes: async () => idleMinutes,
  });
  const open = (
    overrides: Partial<PicaAcpPoolOpening> = {},
  ): Promise<PlanSession> =>
    pool.open({
      session: GROUP,
      signal: new AbortController().signal,
      observer: { started: () => undefined, identified: () => undefined },
      listener: listener(),
      start: async (start) => {
        starts.push(start);
        const native = fakeNative(Promise.resolve(completedTurn()));
        natives.push(native);
        return { session: native, instanceId: `instance-${natives.length}` };
      },
      turn: () => TURN_INPUT,
      ...overrides,
    });
  return { pool, natives, starts, open };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("answers ten rounds of one agent in one group through one native session", async () => {
  const { pool, natives, open } = world();
  for (let round = 1; round <= 10; round += 1) {
    const session = await open();
    await expect(session.turn).resolves.toMatchObject({ failure: null });
    await expect(session.close()).resolves.toMatchObject({
      isConfirmed: true,
    });
  }
  expect(natives).toHaveLength(1);
  expect(natives[0]?.next).toHaveBeenCalledTimes(9);
  expect(natives[0]?.next).toHaveBeenCalledWith(
    TURN_INPUT,
    expect.any(AbortSignal),
    expect.anything(),
  );
  expect(natives[0]?.close).not.toHaveBeenCalled();
  expect(pool.describe()).toEqual([
    expect.objectContaining({
      instanceId: "instance-1",
      agentName: "Ed",
      conversation: "Gruppe „A-Team“",
      state: "idle",
    }),
  ]);
});

it("keeps one session per agent and conversation: three agents hold three, a direct chat one", async () => {
  const { pool, natives, open } = world();
  for (const agentId of ["agent-1", "agent-2", "agent-3"])
    for (let round = 0; round < 3; round += 1) {
      const session = await open({
        session: { ...GROUP, agentId, chatSessionId: `group-${agentId}` },
      });
      await session.turn;
      await session.close();
    }
  const direct = { ...GROUP, chatSessionId: "direct", conversation: "Chat" };
  for (let round = 0; round < 2; round += 1) {
    const session = await open({ session: direct });
    await session.turn;
    await session.close();
  }
  expect(natives).toHaveLength(4);
  expect(pool.describe()).toHaveLength(4);
});

it("refuses a second job while one holds the session, so rounds run one after another", async () => {
  const { natives, open } = world();
  const first = await open();
  await expect(open()).rejects.toMatchObject({ code: "general" });
  await first.turn;
  await first.close();
  const second = await open();
  await second.turn;
  await second.close();
  expect(natives).toHaveLength(1);
  expect(natives[0]?.next).toHaveBeenCalledOnce();
});

it("ends a resting session after the idle time and starts a new one for the next round", async () => {
  const { pool, natives, open } = world(10);
  const first = await open();
  await first.turn;
  await first.close();
  await vi.advanceTimersByTimeAsync(9 * 60_000);
  expect(natives[0]?.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(natives[0]?.close).toHaveBeenCalledOnce();
  expect(pool.describe()).toEqual([]);
  const next = await open();
  await next.turn;
  expect(natives).toHaveLength(2);
  expect(natives[1]?.next).not.toHaveBeenCalled();
});

it("keeps the default idle time when the settings cannot be read", async () => {
  const natives: FakeNative[] = [];
  const pool = new PicaAcpSessionPool({
    idleMinutes: async () => {
      throw new Error("settings unavailable");
    },
  });
  const session = await pool.open({
    session: GROUP,
    signal: new AbortController().signal,
    observer: { started: () => undefined, identified: () => undefined },
    listener: listener(),
    start: async () => {
      const native = fakeNative(Promise.resolve(completedTurn()));
      natives.push(native);
      return { session: native, instanceId: "instance" };
    },
    turn: () => TURN_INPUT,
  });
  await session.close();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(natives[0]?.close).toHaveBeenCalledOnce();
});

it("ends the session at once after a failed turn, a stop or a changed configuration", async () => {
  const { natives, open } = world();
  const failed = await open({
    start: async () => {
      const native = fakeNative(
        Promise.resolve({ ...completedTurn(), failure: "failed" }),
      );
      natives.push(native);
      return { session: native, instanceId: "failed" };
    },
  });
  await failed.turn;
  await failed.close();
  expect(natives[0]?.close).toHaveBeenCalledOnce();

  const controller = new AbortController();
  const stopped = await open({ signal: controller.signal });
  controller.abort();
  await stopped.turn;
  await stopped.close();
  expect(natives[1]?.close).toHaveBeenCalledOnce();

  const kept = await open();
  await kept.turn;
  await kept.close();
  const changed = await open({
    session: { ...GROUP, fingerprint: "configuration-2" },
  });
  await changed.turn;
  expect(natives[2]?.close).toHaveBeenCalledOnce();
  expect(natives).toHaveLength(4);
});

it("forgets a session whose process ended on its own, and ends one on request", async () => {
  const { pool, natives, open } = world();
  const first = await open();
  await first.turn;
  await first.close();
  natives[0]?.end();
  await vi.advanceTimersByTimeAsync(0);
  expect(pool.describe()).toEqual([]);
  const second = await open();
  await second.turn;
  await second.close();
  expect(natives).toHaveLength(2);
  await pool.close(GROUP.chatSessionId);
  expect(natives[1]?.close).toHaveBeenCalledOnce();
  await pool.closeAll();
});

it("gives the place of the longest resting session to a waiting start", async () => {
  const { pool, natives, open } = world();
  expect(pool.reclaimIdle()).toBe(false);
  const older = await open();
  await older.turn;
  await older.close();
  await vi.advanceTimersByTimeAsync(1000);
  const newer = await open({
    session: { ...GROUP, chatSessionId: "other" },
  });
  await newer.turn;
  await newer.close();
  const busy = await open({ session: { ...GROUP, chatSessionId: "busy" } });
  expect(pool.reclaimIdle()).toBe(true);
  expect(pool.reclaimIdle()).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(natives[0]?.close).toHaveBeenCalledOnce();
  expect(natives[1]?.close).not.toHaveBeenCalled();
  expect(pool.describe().map((entry) => entry.state)).toEqual(["idle", "busy"]);
  await busy.close();
});

it("starts a session with a lifetime signal of its own and hands steers and follow-ups to it", async () => {
  const { natives, starts, open } = world();
  const controller = new AbortController();
  const session = await open({ signal: controller.signal });
  expect(starts[0]?.signal).not.toBe(controller.signal);
  expect(starts[0]?.signal.aborted).toBe(false);
  await session.steer?.([{ type: "text", text: "more" }]);
  expect(natives[0]?.steer).toHaveBeenCalledOnce();
  await session.next?.(TURN_INPUT, controller.signal, {
    started: () => undefined,
    identified: () => undefined,
  });
  expect(natives[0]?.next).toHaveBeenCalledOnce();
  await session.close();
  controller.abort();
  expect(starts[0]?.signal.aborted).toBe(false);
});

it("routes updates to the job holding the session and repeats the negotiated steering", async () => {
  const { starts, open } = world();
  const firstListener = listener();
  const first = await open({ listener: firstListener });
  const shared = starts[0]?.listener;
  shared?.initialized?.(true, { image: true });
  shared?.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "one" },
  });
  await first.close();
  shared?.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "between" },
  });
  const secondListener = listener();
  const second = await open({ listener: secondListener });
  expect(secondListener.initialized).toHaveBeenCalledWith(true, {
    image: true,
  });
  shared?.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "two" },
  });
  expect(firstListener.update).toHaveBeenCalledOnce();
  expect(secondListener.update).toHaveBeenCalledOnce();
  await second.close();
});

it("keeps the bridge credential of the session and binds it to every job", async () => {
  const { starts, open } = world();
  const channel: PicaBridgeMcpChannel = {
    descriptor: { url: "http://127.0.0.1/bridge", authorization: "Bearer x" },
    close: vi.fn(),
  };
  const bridge = { open: vi.fn(() => channel), attach: vi.fn() };
  const first = await open({ bridge });
  expect(starts[0]?.channel).toBe(channel);
  await first.close();
  const second = await open({ bridge });
  await second.close();
  expect(bridge.open).toHaveBeenCalledOnce();
  expect(bridge.attach).toHaveBeenCalledWith(channel);
});

it("frees the chat when the start fails", async () => {
  const { pool, open } = world();
  await expect(
    open({
      start: async () => {
        throw new Error("start failed");
      },
    }),
  ).rejects.toThrow("start failed");
  expect(pool.describe()).toEqual([]);
  const session = await open();
  await session.close();
});

it("PAGE-344 prepares the next round against the actual session cursor and resets after idle expiry", async () => {
  const { pool, open, natives } = world(1);
  const prepare = vi.fn<(afterSequence: number | null) => Promise<number>>(
    async () => 1,
  );
  const first = await open({ prepare });
  await first.turn;
  await first.close();
  prepare.mockResolvedValueOnce(31);
  const next = await open({ prepare });
  await next.turn;
  await next.close();
  expect(prepare.mock.calls).toEqual([[null], [1]]);
  expect(natives).toHaveLength(1);
  expect(natives[0]?.next).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  const restarted = await open({ prepare });
  await restarted.turn;
  await restarted.close();
  expect(prepare).toHaveBeenLastCalledWith(null);
  expect(natives).toHaveLength(2);
  await pool.closeAll();
});

it("PAGE-344 discards a cursor after failure and never reclaims an active session", async () => {
  const { pool, open, natives } = world();
  const prepare = vi.fn<(afterSequence: number | null) => Promise<number>>(
    async () => 5,
  );
  const first = await open({ prepare });
  await first.turn;
  expect(pool.reclaimIdle()).toBe(false);
  await first.close();
  natives[0]?.next.mockResolvedValueOnce({
    ...completedTurn(),
    failure: "cancelled",
  });
  const interrupted = await open({ prepare });
  await interrupted.turn;
  await interrupted.close();
  const retry = await open({ prepare });
  await retry.turn;
  await retry.close();
  expect(prepare.mock.calls).toEqual([[null], [5], [null]]);
  expect(natives).toHaveLength(2);
  await pool.closeAll();
});
