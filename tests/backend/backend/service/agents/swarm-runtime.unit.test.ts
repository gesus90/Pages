import { describe, expect, it, vi } from "vitest";

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import {
  AcpAdmissionTimeoutError,
  enqueueAcpRequest,
} from "@/backend/service/agents/resources/AcpAdmissionRequest";
import { SwarmCoordinator } from "@/backend/service/agents/swarm/SwarmCoordinator";
import { SwarmMainLoop } from "@/backend/service/agents/swarm/SwarmMainLoop";
import { SwarmStartError } from "@/backend/service/agents/swarm/SwarmPorts";
import {
  SwarmSessions,
  swarmTurnOf,
} from "@/backend/service/agents/swarm/SwarmSessions";
import { newPlanSwarm } from "@/definition/AgentPlanSwarm";

import type { WaitingRequest } from "@/backend/service/agents/resources/AcpAdmissionRequest";
import type { SwarmTurn } from "@/backend/service/agents/swarm/SwarmPorts";
import type { SwarmOpenedSession } from "@/backend/service/agents/swarm/SwarmSessions";

const OWNER = {
  instanceId: "i",
  userId: "u",
  provider: "codex_cli" as const,
  runId: "r",
  stepId: "s",
};
const MODEL = {
  connectionId: "c",
  provider: "codex_cli" as const,
  model: "m",
  reasoningEffort: null,
};

describe("ACP admission with a deadline", () => {
  it("leaves the queue after the deadline without taking a place", async () => {
    vi.useFakeTimers();
    const waiting: WaitingRequest[] = [];
    const wake = vi.fn();
    const pending = enqueueAcpRequest(
      { waiting, wake },
      OWNER,
      new AbortController().signal,
      120_000,
    );
    expect(waiting).toHaveLength(1);
    vi.advanceTimersByTime(120_000);
    await expect(pending).rejects.toBeInstanceOf(AcpAdmissionTimeoutError);
    expect(waiting).toHaveLength(0);
    vi.useRealTimers();
  });

  it("is admitted before the deadline, or cancelled by its signal", async () => {
    const waiting: WaitingRequest[] = [];
    const admitted = enqueueAcpRequest(
      { waiting, wake: () => undefined },
      OWNER,
      new AbortController().signal,
      1000,
    );
    waiting[0]?.resolve();
    await expect(admitted).resolves.toBeUndefined();
    const controller = new AbortController();
    const cancelled = enqueueAcpRequest(
      { waiting: [], wake: () => undefined },
      OWNER,
      controller.signal,
    );
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(AgentPlanCancelledError);
  });
});

/** A resolved ACP assignment; the session start is mocked, so only the provider matters. */
const RESOLVED: never = JSON.parse(
  '{"assignment":{"connection":{"provider":"codex_cli"},"model":"m","reasoningEffort":null}}',
) as never;

describe("swarm sessions", () => {
  it("starts no helper while only one place is free and never hangs", async () => {
    const open = vi.fn();
    const sessions = new SwarmSessions(
      {
        execution: { open },
        grants: { grant: vi.fn(), revoke: vi.fn(() => Promise.resolve(0)) },
        profiles: { resolveDefinition: vi.fn() },
        capacity: () => ({ limit: 2, active: 1 }),
      },
      {
        userId: "u",
        runId: "r",
        nodeId: "s",
        projectId: "p",
        directory: "/w",
        deadline: Date.now() + 60_000,
        beforeStart: () => Promise.resolve(),
      },
    );
    for (let index = 0; index < 5; index += 1)
      await expect(
        sessions.open({
          role: "worker",
          workerId: `H${String(index + 1)}`,
          model: MODEL,
          access: "read_only",
          prompt: "p",
          signal: new AbortController().signal,
          todos: () => undefined,
        }),
      ).rejects.toEqual(new SwarmStartError("acp_worker_limit"));
    expect(open).not.toHaveBeenCalled();
  });

  it("reports a CLI that is not signed in as a helper that did not start", async () => {
    const { AgentError } = await import("@/backend/error/AgentErrors");
    const revoke = vi.fn(() => Promise.resolve(1));
    const sessions = new SwarmSessions(
      {
        execution: {
          open: vi.fn(() =>
            Promise.reject(new AgentError("cli_not_logged_in")),
          ),
        },
        grants: { grant: vi.fn(() => Promise.resolve(null)), revoke },
        profiles: {
          resolveDefinition: vi.fn(() => Promise.resolve(RESOLVED)),
        },
      },
      {
        userId: "u",
        runId: "r",
        nodeId: "s",
        projectId: "p",
        directory: "/w",
        deadline: Date.now() + 60_000,
        beforeStart: () => Promise.resolve(),
      },
    );
    await expect(
      sessions.open({
        role: "worker",
        workerId: "H1",
        model: MODEL,
        access: "yolo",
        prompt: "p",
        signal: new AbortController().signal,
        todos: () => undefined,
      }),
    ).rejects.toEqual(new SwarmStartError("cli_not_logged_in"));
    expect(revoke).toHaveBeenCalledWith("r", "s::H1");
  });

  it("turns a session turn into a swarm turn", () => {
    const base = {
      output: "x",
      sessionId: null,
      endedAt: "",
      permissionDenials: 0,
      effective: {},
      events: [],
    };
    expect(swarmTurnOf({ ...base, failure: null, errorCode: null })).toEqual({
      output: "x",
      failure: null,
      errorCode: null,
    });
    expect(
      swarmTurnOf({ ...base, failure: "timeout", errorCode: null }).failure,
    ).toBe("timeout");
  });
});

function coordinator(): SwarmCoordinator {
  return new SwarmCoordinator(
    {
      main: { provider: "codex_cli", model: "m" },
      workers: [{ provider: "codex_cli", model: "m", access: "read_only" }],
      instruction: null,
      stored: null,
      signal: new AbortController().signal,
    },
    {
      launcher: { open: () => Promise.reject(new SwarmStartError("x")) },
      probe: { snapshot: () => Promise.reject(new Error("no git")) },
      save: () => Promise.resolve(),
      now: Date.now,
      leaseMs: 1000,
    },
  );
}

function mainSession(turns: Promise<SwarmTurn>[]): {
  readonly open: () => Promise<SwarmOpenedSession>;
  readonly closed: () => boolean;
  readonly reminders: () => number;
} {
  let isClosed = false;
  const next = vi.fn(
    () =>
      turns.shift() ??
      Promise.resolve({
        output: "",
        failure: "failed" as const,
        errorCode: null,
      }),
  );
  return {
    open: () =>
      Promise.resolve({
        session: Object.create(null) as never,
        turn:
          turns.shift() ??
          Promise.resolve({ output: "", failure: null, errorCode: null }),
        next,
        close: () => {
          isClosed = true;
          return Promise.resolve();
        },
      }),
    closed: () => isClosed,
    reminders: () => next.mock.calls.length,
  };
}

describe("swarm main loop", () => {
  const node = {
    ...newPlanSwarm({ id: "s", x: 0, y: 0 }),
    main: { model: MODEL, access: "read_only" as const },
  };
  const context = {
    node,
    task: "t",
    isResumed: false,
    signal: new AbortController().signal,
    todos: () => Promise.resolve(),
  };

  it("ends the node with the summary of swarm_finish", async () => {
    vi.useFakeTimers();
    const swarm = coordinator();
    const session = mainSession([new Promise<SwarmTurn>(() => undefined)]);
    const loop = new SwarmMainLoop(swarm, { open: session.open }, context);
    const result = loop.run();
    await vi.advanceTimersByTimeAsync(0);
    swarm.finish({ status: "succeeded", summary: "all done" });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toEqual({
      status: "succeeded",
      output: "all done",
      error: null,
    });
    expect(session.closed()).toBe(true);
    vi.useRealTimers();
  });

  it("fails the node when the main session is lost, and only then", async () => {
    const swarm = coordinator();
    const session = mainSession([
      Promise.resolve({
        output: "",
        failure: "failed",
        errorCode: "process_exit",
      }),
    ]);
    const result = await new SwarmMainLoop(
      swarm,
      { open: session.open },
      context,
    ).run();
    expect(result).toEqual({
      status: "failed",
      error: "swarm_main_lost",
      output: null,
    });
  });

  it("wakes the main model again after a turn without swarm_finish", async () => {
    vi.useFakeTimers();
    const swarm = coordinator();
    const session = mainSession([
      Promise.resolve({ output: "", failure: null, errorCode: null }),
      new Promise<SwarmTurn>(() => undefined),
    ]);
    const result = new SwarmMainLoop(
      swarm,
      { open: session.open },
      context,
    ).run();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.reminders()).toBe(1);
    swarm.finish({ status: "failed", summary: "no helper capacity" });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toEqual({
      status: "failed",
      output: "no helper capacity",
      error: "swarm_failed",
    });
    vi.useRealTimers();
  });
});
