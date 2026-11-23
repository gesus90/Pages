import { describe, expect, it, vi } from "vitest";

import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";

import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionRunner,
  PlanSessionTurn,
  AgentPlanSessionInput,
} from "@/backend/agents/AgentPlanExecution";
import type { ExecutionAuthorizer } from "@/backend/agents/ScopedExecution";
import type { TextExecution } from "@/backend/agents/TextExecution";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentProviderId } from "@/definition/AgentConnection";

const CONNECTION_ID = "connection";

function sessionInput(provider: AgentProviderId): AgentPlanSessionInput {
  const connection: AgentConnectionRecord = {
    isActive: true,
    id: CONNECTION_ID,
    name: "Connection",
    provider,
    hasApiKey: false,
    testModel: null,
    reasoningEffort: null,
    cliLoggedInAt: null,
    cliAccountLabel: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    agent: { connection, model: "model", reasoningEffort: null },
    userId: "user",
    prompt: "Work",
    directory: "/work",
    options: { access: "yolo", shell: true, web: false, timeoutMinutes: 0 },
    instanceId: "instance",
  };
}

const CLOSED: PlanSessionClosed = {
  exit: null,
  endedAt: "2026-01-01T00:00:00.000Z",
  leftovers: 0,
  isConfirmed: true,
};

const TURN: PlanSessionTurn = {
  output: "done",
  sessionId: null,
  failure: null,
  errorCode: null,
  endedAt: "2026-01-01T00:00:00.000Z",
  permissionDenials: 0,
  effective: {},
  events: [],
};

function minimalSession(closed: PlanSessionClosed = CLOSED): PlanSession {
  return {
    turn: new Promise<PlanSessionTurn>(() => undefined),
    close: () => Promise.resolve(closed),
  };
}

function isHeld(registry: AgentOperationRegistry): boolean {
  try {
    registry.acquire(CONNECTION_ID, "write")();
    return false;
  } catch {
    return true;
  }
}

interface Fixture {
  readonly registry: AgentOperationRegistry;
  readonly authorizer: ExecutionAuthorizer;
  readonly execution: AgentPlanExecution;
  readonly open: ReturnType<typeof vi.fn<PlanSessionRunner["open"]>>;
  readonly api: ReturnType<typeof vi.fn<TextExecution["run"]>>;
}

function fixture(
  options: {
    readonly runner?: Partial<PlanSessionRunner>;
    readonly authorizer?: ExecutionAuthorizer;
  } = {},
): Fixture {
  const registry = new AgentOperationRegistry();
  const authorizer = options.authorizer ?? {
    requireUser: () => Promise.resolve(),
  };
  const open = vi.fn<PlanSessionRunner["open"]>(() =>
    Promise.resolve(minimalSession()),
  );
  const api = vi.fn<TextExecution["run"]>(() => Promise.resolve("answer"));
  const execution = new AgentPlanExecution(
    { run: api },
    { open, ...options.runner },
    registry,
    authorizer,
  );
  return { registry, authorizer, execution, open, api };
}

const OBSERVER: PlanSessionObserver = {
  started: () => undefined,
  identified: () => undefined,
};

describe("AgentPlanExecution durable sessions", () => {
  it("reports whether the runner owns durable local sessions", () => {
    expect(fixture().execution.hasDurableLocalSessions).toBe(false);
    const durable = fixture({ runner: { hasDurableLocalSessions: true } });
    expect(durable.execution.hasDurableLocalSessions).toBe(true);
  });

  it("forwards the end of a plan run when the runner wants it", async () => {
    const finishPlanRun = vi.fn(() => Promise.resolve());
    await fixture({ runner: { finishPlanRun } }).execution.finishPlanRun(
      "run",
      "failed",
    );
    expect(finishPlanRun).toHaveBeenCalledWith("run", "failed");
    await expect(
      fixture().execution.finishPlanRun("run", "succeeded"),
    ).resolves.toBeUndefined();
  });
});

describe("AgentPlanExecution.run", () => {
  it("rejects a connection that is not an API provider", async () => {
    const { execution } = fixture();
    await expect(
      execution.run(sessionInput("codex_cli"), new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider_invalid" });
  });

  it("returns the output, calls beforeStart and releases the connection", async () => {
    const { execution, registry, api } = fixture();
    const beforeStart = vi.fn(() => Promise.resolve());
    const output = await execution.run(
      { ...sessionInput("openai"), beforeStart },
      new AbortController().signal,
    );
    expect(output).toBe("answer");
    expect(beforeStart).toHaveBeenCalledOnce();
    expect(api).toHaveBeenCalledOnce();
    expect(isHeld(registry)).toBe(false);
  });

  it("runs without a beforeStart callback", async () => {
    const { execution } = fixture();
    await expect(
      execution.run(sessionInput("openai"), new AbortController().signal),
    ).resolves.toBe("answer");
  });

  it("rethrows an error of an unaborted request and releases", async () => {
    const { execution, registry, api } = fixture();
    api.mockRejectedValueOnce(new Error("boom"));
    await expect(
      execution.run(sessionInput("openai"), new AbortController().signal),
    ).rejects.toThrow("boom");
    expect(isHeld(registry)).toBe(false);
  });

  it("reports a timeout abort as a timeout", async () => {
    const { execution } = fixture();
    const signal = AbortSignal.abort(new DOMException("late", "TimeoutError"));
    const failure = await execution
      .run(sessionInput("openai"), signal)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentExecutionError);
    expect(failure).toMatchObject({ code: "timeout" });
  });

  it("reports an abort with another DOMException as cancelled", async () => {
    const { execution } = fixture();
    await expect(
      execution.run(sessionInput("openai"), AbortSignal.abort()),
    ).rejects.toBeInstanceOf(AgentPlanCancelledError);
  });

  it("reports an abort with a non-DOMException reason as cancelled", async () => {
    const { execution } = fixture();
    await expect(
      execution.run(sessionInput("openai"), AbortSignal.abort("stop")),
    ).rejects.toBeInstanceOf(AgentPlanCancelledError);
  });
});

describe("AgentPlanExecution.open", () => {
  it("rejects a connection that is not an ACP provider", async () => {
    const { execution, open } = fixture();
    await expect(
      execution.open(
        sessionInput("anthropic"),
        new AbortController().signal,
        OBSERVER,
      ),
    ).rejects.toMatchObject({ code: "provider_invalid" });
    expect(open).not.toHaveBeenCalled();
  });

  it("checks the Claude budget only for Claude Code", async () => {
    const requireClaudeBudget = vi.fn(() => Promise.resolve());
    const { execution } = fixture({
      authorizer: { requireUser: () => Promise.resolve(), requireClaudeBudget },
    });
    const signal = new AbortController().signal;
    await execution.open(sessionInput("codex_cli"), signal, OBSERVER);
    expect(requireClaudeBudget).not.toHaveBeenCalled();
    await execution.open(sessionInput("claude_code"), signal, OBSERVER);
    expect(requireClaudeBudget).toHaveBeenCalledWith("user");
  });

  it("opens Claude Code without a budget check when the authorizer has none", async () => {
    const { execution, open } = fixture();
    await execution.open(
      sessionInput("claude_code"),
      new AbortController().signal,
      OBSERVER,
    );
    expect(open).toHaveBeenCalledOnce();
  });

  it("releases the connection when opening fails", async () => {
    const { execution, registry, open } = fixture();
    open.mockRejectedValueOnce(new Error("no start"));
    await expect(
      execution.open(
        sessionInput("codex_cli"),
        new AbortController().signal,
        OBSERVER,
      ),
    ).rejects.toThrow("no start");
    expect(isHeld(registry)).toBe(false);
  });

  it("releases after an unconfirmed cleanup for a provider that need not confirm", async () => {
    const { execution, registry, open } = fixture();
    open.mockRejectedValueOnce(new AcpCleanupUnconfirmedError());
    await expect(
      execution.open(
        sessionInput("codex_cli"),
        new AbortController().signal,
        OBSERVER,
      ),
    ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);
    expect(isHeld(registry)).toBe(false);
  });

  it("keeps the connection held after an unconfirmed cleanup that must be confirmed", async () => {
    const { execution, registry, open } = fixture();
    open.mockRejectedValueOnce(new AcpCleanupUnconfirmedError());
    await expect(
      execution.open(
        sessionInput("opencode"),
        new AbortController().signal,
        OBSERVER,
      ),
    ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);
    expect(isHeld(registry)).toBe(true);
  });

  it("releases a provider that must confirm when another error fails the open", async () => {
    const { execution, registry, open } = fixture();
    open.mockRejectedValueOnce(new AgentError("plan_invalid"));
    await expect(
      execution.open(
        sessionInput("openrouter"),
        new AbortController().signal,
        OBSERVER,
      ),
    ).rejects.toMatchObject({ code: "plan_invalid" });
    expect(isHeld(registry)).toBe(false);
  });

  it("passes the observer through for a provider without confirmation", async () => {
    const { execution, open } = fixture();
    await execution.open(
      sessionInput("codex_cli"),
      new AbortController().signal,
      OBSERVER,
    );
    expect(open.mock.calls[0]?.[2]).toBe(OBSERVER);
  });
});

describe("AgentPlanExecution retirement of confirmed providers", () => {
  async function observed(observer: PlanSessionObserver): Promise<{
    readonly registry: AgentOperationRegistry;
    readonly seen: PlanSessionObserver;
  }> {
    const { execution, registry, open } = fixture();
    await execution.open(
      sessionInput("antigravity"),
      new AbortController().signal,
      observer,
    );
    const seen = open.mock.calls[0]?.[2];
    if (!seen) throw new Error("observer missing");
    return { registry, seen };
  }

  it("releases and reports when the retirement is confirmed", async () => {
    const retired = vi.fn();
    const { registry, seen } = await observed({ ...OBSERVER, retired });
    expect(isHeld(registry)).toBe(true);
    seen.retired?.(CLOSED, "process_exit");
    expect(isHeld(registry)).toBe(false);
    expect(retired).toHaveBeenCalledWith(CLOSED, "process_exit");
  });

  it("keeps the connection when the retirement is unconfirmed", async () => {
    const retired = vi.fn();
    const { registry, seen } = await observed({ ...OBSERVER, retired });
    seen.retired?.({ ...CLOSED, isConfirmed: false }, "process_exit");
    expect(isHeld(registry)).toBe(true);
    expect(retired).toHaveBeenCalledOnce();
  });

  it("tolerates an observer without a retirement callback", async () => {
    const { registry, seen } = await observed(OBSERVER);
    seen.retired?.(CLOSED, "process_exit");
    expect(isHeld(registry)).toBe(false);
  });
});

describe("AgentPlanExecution session wrapper", () => {
  it("exposes only the capabilities the runner session has", async () => {
    const { execution } = fixture();
    const session = await execution.open(
      sessionInput("codex_cli"),
      new AbortController().signal,
      OBSERVER,
    );
    expect(session.steer).toBeUndefined();
    expect(session.interrupt).toBeUndefined();
    expect(session.suspend).toBeUndefined();
    expect(session.resume).toBeUndefined();
    expect(session.cancelTool).toBeUndefined();
    expect(session.setPaused).toBeUndefined();
    expect(session.next).toBeUndefined();
    expect(session.detach).toBeUndefined();
    expect(session.isDetached).toBe(false);
  });

  it("delegates every capability to the runner session", async () => {
    const detach = vi.fn();
    const setPaused = vi.fn(() => Promise.resolve());
    const inner: PlanSession = {
      ...minimalSession(),
      isDurable: true,
      isDetached: true,
      detach,
      steer: vi.fn(),
      interrupt: vi.fn(() => Promise.resolve(true)),
      suspend: vi.fn(() => Promise.resolve(true)),
      resume: vi.fn(() => Promise.resolve(false)),
      cancelTool: vi.fn(() => Promise.resolve(true)),
      setPaused,
    };
    const { execution, open } = fixture();
    open.mockResolvedValueOnce(inner);
    const session = await execution.open(
      sessionInput("codex_cli"),
      new AbortController().signal,
      OBSERVER,
    );
    expect(session.isDurable).toBe(true);
    expect(session.isDetached).toBe(true);
    session.detach?.();
    expect(detach).toHaveBeenCalledOnce();
    await expect(session.interrupt?.()).resolves.toBe(true);
    await expect(session.suspend?.()).resolves.toBe(true);
    await expect(session.resume?.()).resolves.toBe(false);
    await expect(session.cancelTool?.("note")).resolves.toBe(true);
    await session.setPaused?.(true);
    expect(setPaused).toHaveBeenCalledWith(true);
    await session.steer?.([]);
    expect(inner.steer).toHaveBeenCalledWith([]);
  });

  it("resolves setPaused when the runner returns nothing", async () => {
    const inner: PlanSession = {
      ...minimalSession(),
      setPaused: vi.fn(),
    };
    const { execution, open } = fixture();
    open.mockResolvedValueOnce(inner);
    const session = await execution.open(
      sessionInput("codex_cli"),
      new AbortController().signal,
      OBSERVER,
    );
    await expect(session.setPaused?.(false)).resolves.toBeUndefined();
  });
});

describe("AgentPlanExecution next step", () => {
  it("authorizes and prepares the next step before delegating it", async () => {
    const next = vi.fn<NonNullable<PlanSession["next"]>>(() =>
      Promise.resolve(TURN),
    );
    const requireUser = vi.fn(() => Promise.resolve());
    const { execution, open } = fixture({ authorizer: { requireUser } });
    open.mockResolvedValueOnce({ ...minimalSession(), next });
    const session = await execution.open(
      sessionInput("antigravity"),
      new AbortController().signal,
      OBSERVER,
    );
    const beforeStart = vi.fn(() => Promise.resolve());
    const signal = new AbortController().signal;
    const turn = await session.next?.(
      { ...sessionInput("antigravity"), beforeStart },
      signal,
      OBSERVER,
    );
    expect(turn).toBe(TURN);
    expect(beforeStart).toHaveBeenCalledOnce();
    expect(requireUser).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[0]?.[1]).toBe(signal);
  });

  it("starts the next step without a beforeStart callback", async () => {
    const next = vi.fn<NonNullable<PlanSession["next"]>>(() =>
      Promise.resolve(TURN),
    );
    const { execution, open } = fixture();
    open.mockResolvedValueOnce({ ...minimalSession(), next });
    const session = await execution.open(
      sessionInput("codex_cli"),
      new AbortController().signal,
      OBSERVER,
    );
    await session.next?.(
      sessionInput("codex_cli"),
      new AbortController().signal,
      OBSERVER,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("fails the next step when the runner session lost its next capability", async () => {
    const inner: PlanSession = {
      ...minimalSession(),
      next: () => Promise.resolve(TURN),
    };
    const { execution, open } = fixture();
    open.mockResolvedValueOnce(inner);
    const session = await execution.open(
      sessionInput("codex_cli"),
      new AbortController().signal,
      OBSERVER,
    );
    inner.next = undefined;
    await expect(
      session.next?.(
        sessionInput("codex_cli"),
        new AbortController().signal,
        OBSERVER,
      ),
    ).rejects.toMatchObject({ code: "plan_step_failed" });
  });
});

describe("AgentPlanExecution session closing", () => {
  it("releases the connection when a confirmed session closes", async () => {
    const { execution, registry } = fixture();
    const session = await execution.open(
      sessionInput("opencode"),
      new AbortController().signal,
      OBSERVER,
    );
    expect(isHeld(registry)).toBe(true);
    await expect(session.close()).resolves.toBe(CLOSED);
    expect(isHeld(registry)).toBe(false);
  });

  it("keeps the connection when a close is unconfirmed and must be confirmed", async () => {
    const unconfirmed = { ...CLOSED, isConfirmed: false };
    const { execution, registry, open } = fixture();
    open.mockResolvedValueOnce(minimalSession(unconfirmed));
    const session = await execution.open(
      sessionInput("opencode"),
      new AbortController().signal,
      OBSERVER,
    );
    await session.close();
    expect(isHeld(registry)).toBe(true);
  });

  it("releases an unconfirmed close of a provider that need not confirm", async () => {
    const unconfirmed = { ...CLOSED, isConfirmed: false };
    const { execution, registry, open } = fixture();
    open.mockResolvedValueOnce(minimalSession(unconfirmed));
    const session = await execution.open(
      sessionInput("codex_cli"),
      new AbortController().signal,
      OBSERVER,
    );
    await session.close();
    expect(isHeld(registry)).toBe(false);
  });

  it("releases a failing close of a provider that need not confirm", async () => {
    const { execution, registry, open } = fixture();
    open.mockResolvedValueOnce({
      ...minimalSession(),
      close: () => Promise.reject(new Error("close failed")),
    });
    const session = await execution.open(
      sessionInput("codex_cli"),
      new AbortController().signal,
      OBSERVER,
    );
    await expect(session.close()).rejects.toThrow("close failed");
    expect(isHeld(registry)).toBe(false);
  });
});
