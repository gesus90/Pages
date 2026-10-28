import { expect, it, vi } from "vitest";

import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { DEFAULT_AGENT_RUN_OPTIONS } from "@/definition/AgentConfiguration";

import type {
  AgentPlanSessionInput,
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionRunner,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { TextExecution } from "@/backend/agents/TextExecution";
import type { AgentProviderId } from "@/definition/AgentConnection";

const CONNECTION = "connection-1";

const TURN: PlanSessionTurn = {
  output: "done",
  sessionId: "session",
  failure: null,
  errorCode: null,
  endedAt: "2026-10-20T10:00:00.000Z",
  permissionDenials: 0,
  effective: {},
  events: [],
};

const OBSERVER: PlanSessionObserver = {
  started: () => undefined,
  identified: () => undefined,
};

function closed(isConfirmed: boolean): PlanSessionClosed {
  return { exit: null, endedAt: TURN.endedAt, leftovers: 0, isConfirmed };
}

function input(
  provider: AgentProviderId,
  beforeStart?: () => Promise<void>,
): AgentPlanSessionInput {
  return {
    agent: {
      model: "model",
      reasoningEffort: null,
      connection: {
        id: CONNECTION,
        name: "Connection",
        provider,
        isActive: true,
        hasApiKey: true,
        testModel: null,
        reasoningEffort: null,
        cliLoggedInAt: null,
        cliAccountLabel: null,
        updatedAt: "2026-01-01",
      },
    },
    userId: "owner",
    prompt: "Prompt",
    directory: "/work",
    options: DEFAULT_AGENT_RUN_OPTIONS,
    instanceId: "instance",
    mcp: null,
    ...(beforeStart ? { beforeStart } : {}),
  };
}

/** Whether the connection is still held by a running execution. */
function isHeld(registry: AgentOperationRegistry): boolean {
  try {
    registry.acquire(CONNECTION, "check")();
    return false;
  } catch {
    return true;
  }
}

interface Setup {
  readonly execution: AgentPlanExecution;
  readonly registry: AgentOperationRegistry;
  readonly requireUser: ReturnType<typeof vi.fn>;
}

function setup(
  api: TextExecution["run"] = async () => "answer",
  cli: PlanSessionRunner["open"] = async () => session(),
): Setup {
  const registry = new AgentOperationRegistry();
  const requireUser = vi.fn(async () => undefined);
  return {
    execution: new AgentPlanExecution({ run: api }, { open: cli }, registry, {
      requireUser,
    }),
    registry,
    requireUser,
  };
}

function session(changes: Partial<PlanSession> = {}): PlanSession {
  return {
    turn: Promise.resolve(TURN),
    close: async () => closed(true),
    ...changes,
  };
}

it("runs an API request after authorization and releases the connection", async () => {
  const beforeStart = vi.fn(async () => undefined);
  const { execution, registry, requireUser } = setup();
  const signal = new AbortController().signal;
  expect(await execution.run(input("openai", beforeStart), signal)).toBe(
    "answer",
  );
  expect(requireUser).toHaveBeenCalledWith("owner", CONNECTION);
  expect(beforeStart).toHaveBeenCalledOnce();
  expect(isHeld(registry)).toBe(false);
  expect(await execution.run(input("openai"), signal)).toBe("answer");
});

it("refuses an API request for a CLI connection and a session for an API connection", async () => {
  const { execution, requireUser } = setup();
  const signal = new AbortController().signal;
  await expect(execution.run(input("codex_cli"), signal)).rejects.toMatchObject(
    { code: "provider_invalid" },
  );
  await expect(
    execution.open(input("openai"), signal, OBSERVER),
  ).rejects.toMatchObject({ code: "provider_invalid" });
  expect(requireUser).not.toHaveBeenCalled();
});

it("rethrows a provider failure and releases the connection", async () => {
  const failure = new Error("provider");
  const { execution, registry } = setup(async () => {
    throw failure;
  });
  await expect(
    execution.run(input("openai"), new AbortController().signal),
  ).rejects.toBe(failure);
  expect(isHeld(registry)).toBe(false);
});

it("reports a timed-out request as a timeout", async () => {
  const controller = new AbortController();
  const { execution } = setup(async () => {
    controller.abort(new DOMException("late", "TimeoutError"));
    throw new Error("aborted");
  });
  await expect(
    execution.run(input("openai"), controller.signal),
  ).rejects.toMatchObject({ code: "timeout" });
});

it.each([
  ["a plain reason", "stop"],
  ["an abort exception", new DOMException("stop", "AbortError")],
])(
  "reports a request cancelled with %s as cancelled",
  async (scenario, reason) => {
    const controller = new AbortController();
    const { execution } = setup(async () => {
      controller.abort(reason);
      return "late answer";
    });
    await expect(
      execution.run(input("openai"), controller.signal),
    ).rejects.toBeInstanceOf(AgentPlanCancelledError);
  },
);

it("holds the connection until a session is closed", async () => {
  const { execution, registry } = setup();
  const opened = await execution.open(
    input("codex_cli"),
    new AbortController().signal,
    OBSERVER,
  );
  expect(opened).not.toHaveProperty("steer");
  expect(opened).not.toHaveProperty("next");
  expect(await opened.turn).toBe(TURN);
  expect(isHeld(registry)).toBe(true);
  expect(await opened.close()).toEqual(closed(true));
  expect(isHeld(registry)).toBe(false);
});

it("releases a session that failed to open", async () => {
  const failure = new Error("spawn");
  const { execution, registry } = setup(undefined, async () => {
    throw failure;
  });
  await expect(
    execution.open(input("codex_cli"), new AbortController().signal, OBSERVER),
  ).rejects.toBe(failure);
  expect(isHeld(registry)).toBe(false);
});

it("keeps an OpenCode connection held while its cleanup is unconfirmed", async () => {
  const unconfirmed = setup(undefined, async () => {
    throw new AcpCleanupUnconfirmedError();
  });
  await expect(
    unconfirmed.execution.open(
      input("opencode"),
      new AbortController().signal,
      OBSERVER,
    ),
  ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);
  expect(isHeld(unconfirmed.registry)).toBe(true);
  const failed = setup(undefined, async () => {
    throw new Error("spawn");
  });
  await expect(
    failed.execution.open(
      input("opencode"),
      new AbortController().signal,
      OBSERVER,
    ),
  ).rejects.toThrow("spawn");
  expect(isHeld(failed.registry)).toBe(false);
});

it("releases an OpenCode connection only after a confirmed close", async () => {
  let isConfirmed = false;
  const { execution, registry } = setup(undefined, async () =>
    session({ close: async () => closed(isConfirmed) }),
  );
  const opened = await execution.open(
    input("opencode"),
    new AbortController().signal,
    OBSERVER,
  );
  await opened.close();
  expect(isHeld(registry)).toBe(true);
  isConfirmed = true;
  await opened.close();
  expect(isHeld(registry)).toBe(false);
});

it("keeps an OpenCode connection held when closing fails", async () => {
  const { execution, registry } = setup(undefined, async () =>
    session({
      close: async () => {
        throw new Error("close");
      },
    }),
  );
  const opened = await execution.open(
    input("opencode"),
    new AbortController().signal,
    OBSERVER,
  );
  await expect(opened.close()).rejects.toThrow("close");
  expect(isHeld(registry)).toBe(true);
});

it("releases an OpenCode connection when the adapter retires the session confirmed", async () => {
  const cli = vi.fn<PlanSessionRunner["open"]>(async () => session());
  const { execution, registry } = setup(undefined, cli);
  const retired = vi.fn();
  await execution.open(input("opencode"), new AbortController().signal, {
    ...OBSERVER,
    retired,
  });
  const observer = cli.mock.calls[0]?.[2];
  observer?.retired?.(closed(false), "process_exit");
  expect(isHeld(registry)).toBe(true);
  observer?.retired?.(closed(true), "idle_timeout");
  expect(isHeld(registry)).toBe(false);
  expect(retired.mock.calls).toEqual([
    [closed(false), "process_exit"],
    [closed(true), "idle_timeout"],
  ]);
  await execution.open(
    input("opencode"),
    new AbortController().signal,
    OBSERVER,
  );
  expect(() =>
    cli.mock.calls[1]?.[2].retired?.(closed(true), "idle_timeout"),
  ).not.toThrow();
});

it("passes the observer of another runner through unchanged", async () => {
  const cli = vi.fn<PlanSessionRunner["open"]>(async () => session());
  const { execution } = setup(undefined, cli);
  const signal = new AbortController().signal;
  await execution.open(input("claude_code"), signal, OBSERVER);
  expect(cli).toHaveBeenCalledWith(input("claude_code"), signal, OBSERVER);
});

it("steers and continues a session after a fresh authorization", async () => {
  const steer = vi.fn(async () => "injected" as const);
  const next = vi.fn<NonNullable<PlanSession["next"]>>(async () => TURN);
  const native = session({ steer, next });
  const { execution, requireUser } = setup(undefined, async () => native);
  const opened = await execution.open(
    input("codex_cli"),
    new AbortController().signal,
    OBSERVER,
  );
  await opened.steer?.([{ type: "text", text: "more" }]);
  expect(steer).toHaveBeenCalledWith([{ type: "text", text: "more" }]);
  const beforeStart = vi.fn(async () => undefined);
  const signal = new AbortController().signal;
  expect(
    await opened.next?.(input("codex_cli", beforeStart), signal, OBSERVER),
  ).toBe(TURN);
  expect(requireUser).toHaveBeenCalledTimes(2);
  expect(beforeStart).toHaveBeenCalledOnce();
  expect(next).toHaveBeenCalledWith(
    input("codex_cli", beforeStart),
    signal,
    OBSERVER,
  );
  await opened.next?.(input("codex_cli"), signal, OBSERVER);
  expect(next).toHaveBeenCalledTimes(2);
});

it("refuses to continue a session whose runner dropped its continuation", async () => {
  const native = session({ next: async () => TURN });
  const { execution } = setup(undefined, async () => native);
  const opened = await execution.open(
    input("codex_cli"),
    new AbortController().signal,
    OBSERVER,
  );
  delete native.next;
  await expect(
    opened.next?.(input("codex_cli"), new AbortController().signal, OBSERVER),
  ).rejects.toMatchObject({ code: "plan_step_failed" });
});
