import { beforeEach, describe, expect, it, vi } from "vitest";

import { AutomationRunExecutor } from "./AutomationRunExecutor";

import type { Mock } from "vitest";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { StoredAutomationRun } from "@/backend/database/repositories/automation/AutomationRunRepository";
import type { AutomationAccess } from "./AutomationAccess";
import type { AutomationAccount } from "./AutomationDirectory";
import type { AutomationRunEnding } from "./AutomationRunEnding";
import type { AutomationExecutionPorts } from "./AutomationRunExecutor";
import type { AutomationScriptResult } from "./AutomationScriptProcess";

const state = vi.hoisted(() => ({
  automation: null as object | null,
  jobs: [] as object[],
  find: vi.fn(),
  enqueue: vi.fn(),
  deliver: vi.fn(),
  forRuns: vi.fn(),
  logCaughtError: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: state.logCaughtError,
}));
vi.mock(
  "@/backend/database/repositories/automation/AutomationRepository",
  () => ({
    AutomationRepository: class {
      public find = async (id: string): Promise<object | null> => {
        state.find(id);
        return state.automation;
      };
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRunRepository",
  () => ({
    AutomationRunRepository: class {
      public deliver = state.deliver;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationAgentJobRepository",
  () => ({
    AutomationAgentJobRepository: class {
      public enqueue = state.enqueue;
      public forRuns = async (ids: string[]): Promise<object[]> => {
        state.forRuns(ids);
        return state.jobs;
      };
    },
  }),
);

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const NOW = new Date("2026-11-25T10:00:00.000Z");

const creator: AutomationAccount = {
  id: "u1",
  displayName: "User",
  isAgent: false,
  isActive: true,
  isAdministrator: false,
  isReadOnly: false,
  timeZone: "UTC",
  language: "en",
};

const SCRIPT = {
  type: "script",
  workspaceId: "w1",
  interpreterProfileId: "i1",
  content: "echo",
  timeoutSeconds: 30,
};

function automationOf(action: object): StoredAutomation {
  return doubleOf<StoredAutomation>({
    id: "a1",
    creatorId: "u1",
    name: "Nightly",
    trigger: { type: "schedule" },
    action,
    sharing: { scope: "private" },
    isActive: true,
    deleteAfterSuccess: false,
    agentNotification: { mode: "off", agentId: null },
    revision: 1,
  });
}

function runOf(overrides: object = {}): StoredAutomationRun {
  return doubleOf<StoredAutomationRun>({
    id: "r1",
    automationId: "a1",
    triggerKind: "schedule",
    eventType: null,
    triggerData: null,
    planRunId: null,
    queuedAt: "2026-11-25T09:00:00.000Z",
    ...overrides,
  });
}

function resultOf(overrides: object = {}): AutomationScriptResult {
  return {
    exitCode: 0,
    signal: null,
    failure: null,
    stdout: "line",
    stderr: "",
    ...overrides,
  };
}

interface Fixture {
  readonly executor: AutomationRunExecutor;
  readonly end: ReturnType<typeof vi.fn>;
  readonly account: ReturnType<typeof vi.fn>;
  readonly canUseAgent: ReturnType<typeof vi.fn>;
  readonly runBlocker: ReturnType<typeof vi.fn>;
  readonly startPlan: ReturnType<typeof vi.fn>;
  readonly planRunStatus: ReturnType<typeof vi.fn>;
  readonly runScript: Mock<AutomationExecutionPorts["runScript"]>;
}

function fixture(): Fixture {
  const end = vi.fn(async () => undefined);
  const account = vi.fn(async () => creator);
  const canUseAgent = vi.fn(async () => true);
  const runBlocker = vi.fn(async () => null);
  const startPlan = vi.fn(async () => "pr1");
  const planRunStatus = vi.fn(async () => "running");
  const runScript = vi.fn<AutomationExecutionPorts["runScript"]>(async () =>
    resultOf(),
  );
  const executor = new AutomationRunExecutor({
    database: doubleOf({}),
    rules: doubleOf<AutomationAccess>({ account, canUseAgent, runBlocker }),
    ending: doubleOf<AutomationRunEnding>({ end }),
    ports: doubleOf<AutomationExecutionPorts>({
      startPlan,
      planRunStatus,
      runScript,
    }),
    now: () => NOW,
  });
  return {
    executor,
    end,
    account,
    canUseAgent,
    runBlocker,
    startPlan,
    planRunStatus,
    runScript,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.automation = automationOf(SCRIPT);
  state.jobs = [];
});

describe("start", () => {
  it("ignores a missing automation", async () => {
    state.automation = null;
    const { executor, end } = fixture();
    await executor.start(runOf());
    expect(end).not.toHaveBeenCalled();
    expect(executor.isExecuting("r1")).toBe(false);
  });

  it("ends a blocked run as forbidden", async () => {
    const { executor, end, runBlocker } = fixture();
    runBlocker.mockResolvedValue("no_rights");
    await executor.start(runOf());
    expect(end).toHaveBeenCalledWith(runOf(), {
      outcome: "forbidden",
      errorCode: "no_rights",
    });
  });

  it("enqueues an agent action", async () => {
    state.automation = automationOf({
      type: "agent",
      agentId: "g1",
      instruction: "do it",
    });
    const { executor } = fixture();
    await executor.start(runOf());
    expect(state.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "r1",
        agentId: "g1",
        kind: "action",
        queuedAt: NOW.toISOString(),
      }),
    );
  });

  it("fails an agent action without a creator", async () => {
    state.automation = automationOf({
      type: "agent",
      agentId: "g1",
      instruction: "do it",
    });
    const { executor, account, end } = fixture();
    account.mockResolvedValue(null);
    await executor.start(runOf());
    expect(state.logCaughtError).toHaveBeenCalled();
    expect(end).toHaveBeenCalledWith(runOf(), {
      outcome: "failed",
      errorCode: "failed",
    });
  });

  it("starts a plan and delivers the run", async () => {
    state.automation = automationOf({ type: "plan", planId: "p1" });
    const { executor, startPlan } = fixture();
    await executor.start(runOf());
    expect(startPlan).toHaveBeenCalledWith("u1", "p1");
    expect(state.deliver).toHaveBeenCalledWith("r1", "pr1");
  });

  it("uses the code of a failing start", async () => {
    state.automation = automationOf({ type: "plan", planId: "p1" });
    const { executor, startPlan, end } = fixture();
    startPlan.mockRejectedValue(
      Object.assign(new Error("x"), { code: "c".repeat(100) }),
    );
    await executor.start(runOf());
    expect(end).toHaveBeenCalledWith(runOf(), {
      outcome: "failed",
      errorCode: "c".repeat(80),
    });
  });

  it("falls back to a generic code", async () => {
    state.automation = automationOf({ type: "plan", planId: "p1" });
    const { executor, startPlan, end } = fixture();
    const failed = { outcome: "failed", errorCode: "failed" };
    startPlan.mockRejectedValueOnce(new Error("plain"));
    await executor.start(runOf());
    startPlan.mockRejectedValueOnce(Object.assign(new Error("n"), { code: 1 }));
    await executor.start(runOf());
    startPlan.mockRejectedValueOnce("text");
    await executor.start(runOf());
    expect(end).toHaveBeenCalledTimes(3);
    expect(end).toHaveBeenLastCalledWith(runOf(), failed);
  });
});

describe("script", () => {
  it("runs a script and ends the run with its result", async () => {
    const { executor, end, runScript } = fixture();
    runScript.mockResolvedValue(
      resultOf({ stdout: "\n  first  \nsecond", stderr: "warn" }),
    );
    await executor.start(runOf({ triggerData: '{"a":1}', eventType: "e" }));
    const request = runScript.mock.calls[0]?.[0] as {
      input: string;
      content: string;
    };
    expect(JSON.parse(request.input)).toMatchObject({
      runId: "r1",
      trigger: "schedule",
      eventType: "e",
      data: { a: 1 },
    });
    expect(state.deliver).toHaveBeenCalledWith("r1", null);
    expect(end).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        outcome: "ok",
        exitCode: 0,
        forwardState: null,
        errorCode: null,
        summary: "first",
        output: "\n  first  \nsecond\n[stderr]\nwarn",
        error: "warn",
      }),
    );
    expect(executor.isExecuting("r1")).toBe(false);
  });

  it("tolerates broken trigger data and a missing content", async () => {
    state.automation = automationOf({ ...SCRIPT, content: null });
    const { executor, runScript } = fixture();
    await executor.start(runOf({ triggerData: "{broken" }));
    const request = runScript.mock.calls[0]?.[0] as {
      input: string;
      content: string;
    };
    expect(request.content).toBe("");
    expect(JSON.parse(request.input)).toMatchObject({ data: null });
  });

  it("reports a failed script", async () => {
    const { executor, end, runScript } = fixture();
    runScript.mockResolvedValue(
      resultOf({ exitCode: 1, stdout: null, stderr: "bad" }),
    );
    await executor.start(runOf());
    runScript.mockResolvedValue(
      resultOf({ exitCode: null, failure: "timeout", stdout: "", stderr: "" }),
    );
    await executor.start(runOf());
    expect(end).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        outcome: "failed",
        errorCode: "exit",
        summary: "bad",
      }),
    );
    expect(end).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        errorCode: "timeout",
        summary: null,
        error: null,
      }),
    );
  });

  it("is executing while the script runs and can be aborted", async () => {
    const { executor, end, runScript } = fixture();
    let signal: AbortSignal | undefined;
    runScript.mockImplementation(
      (request: { signal: AbortSignal }) =>
        new Promise<AutomationScriptResult>((resolve) => {
          signal = request.signal;
          request.signal.addEventListener("abort", () => {
            resolve(resultOf({ exitCode: null, failure: "cancelled" }));
          });
        }),
    );
    const started = executor.start(runOf());
    await vi.waitFor(() => {
      expect(signal).toBeDefined();
    });
    expect(executor.isExecuting("r1")).toBe(true);
    await executor.settle(runOf());
    expect(state.forRuns).not.toHaveBeenCalled();
    executor.abortAll();
    await started;
    expect(signal?.aborted).toBe(true);
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe("forward", () => {
  function forwarding(when: string): void {
    state.automation = automationOf({
      ...SCRIPT,
      forward: { agentId: "g1", when },
    });
  }

  it("wakes the agent when the condition holds", async () => {
    forwarding("always");
    const { executor, end } = fixture();
    await executor.start(runOf());
    expect(state.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "forward", agentId: "g1" }),
    );
    expect(end).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ forwardState: "woken" }),
    );
  });

  it("evaluates the zero and nonzero conditions", async () => {
    const { executor, end, runScript } = fixture();
    const states: unknown[] = [];
    for (const [when, exitCode] of [
      ["zero", 0],
      ["zero", 1],
      ["nonzero", 1],
      ["nonzero", 0],
    ] as const) {
      forwarding(when);
      runScript.mockResolvedValue(resultOf({ exitCode }));
      await executor.start(runOf());
      states.push(
        (end.mock.calls.at(-1)?.[1] as { forwardState: string }).forwardState,
      );
    }
    expect(states).toEqual(["woken", "not_woken", "woken", "not_woken"]);
  });

  it("does not wake an agent the creator cannot use", async () => {
    forwarding("always");
    const { executor, end, canUseAgent } = fixture();
    canUseAgent.mockResolvedValue(false);
    await executor.start(runOf());
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ forwardState: "not_woken" }),
    );
  });
});

describe("settle", () => {
  it("settles a plan run that ended", async () => {
    const { executor, end, planRunStatus } = fixture();
    planRunStatus.mockResolvedValue("succeeded");
    await executor.settle(runOf({ planRunId: "pr1" }));
    expect(end).toHaveBeenCalledWith(expect.anything(), {
      outcome: "ok",
      planRunStatus: "succeeded",
      errorCode: null,
    });
    planRunStatus.mockResolvedValue("failed");
    await executor.settle(runOf({ planRunId: "pr1" }));
    expect(end).toHaveBeenLastCalledWith(expect.anything(), {
      outcome: "failed",
      planRunStatus: "failed",
      errorCode: null,
    });
  });

  it("settles a plan run that is gone", async () => {
    const { executor, end, planRunStatus } = fixture();
    planRunStatus.mockResolvedValue(null);
    await executor.settle(runOf({ planRunId: "pr1" }));
    expect(end).toHaveBeenCalledWith(expect.anything(), {
      outcome: "failed",
      planRunStatus: null,
      errorCode: "plan_run_unavailable",
    });
  });

  it("waits for a plan run that is active", async () => {
    const { executor, end } = fixture();
    await executor.settle(runOf({ planRunId: "pr1" }));
    expect(end).not.toHaveBeenCalled();
  });

  it("ignores a plan run without automation", async () => {
    state.automation = null;
    const { executor, end } = fixture();
    await executor.settle(runOf({ planRunId: "pr1" }));
    expect(end).not.toHaveBeenCalled();
  });

  it("ends a run without a job as interrupted", async () => {
    state.jobs = [{ kind: "forward", state: "completed" }];
    const { executor, end } = fixture();
    await executor.settle(runOf());
    expect(end).toHaveBeenCalledWith(expect.anything(), {
      outcome: "failed",
      errorCode: "interrupted",
    });
  });

  it("settles from the answer of a completed job", async () => {
    state.jobs = [{ kind: "action", state: "completed", answer: "\nYes" }];
    const { executor, end } = fixture();
    await executor.settle(runOf());
    expect(end).toHaveBeenCalledWith(expect.anything(), {
      outcome: "ok",
      answer: "\nYes",
      summary: "Yes",
    });
  });

  it("settles a completed job without answer and shortens summaries", async () => {
    state.jobs = [{ kind: "action", state: "completed", answer: null }];
    const { executor, end } = fixture();
    await executor.settle(runOf());
    expect(end).toHaveBeenLastCalledWith(expect.anything(), {
      outcome: "ok",
      answer: "",
      summary: null,
    });
    state.jobs = [
      { kind: "action", state: "completed", answer: "x".repeat(300) },
    ];
    await executor.settle(runOf());
    const summary = (end.mock.calls.at(-1)?.[1] as { summary: string }).summary;
    expect(Array.from(summary)).toHaveLength(200);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("settles a failed job", async () => {
    const { executor, end } = fixture();
    state.jobs = [{ kind: "action", state: "failed", errorCode: "forbidden" }];
    await executor.settle(runOf());
    expect(end).toHaveBeenLastCalledWith(expect.anything(), {
      outcome: "forbidden",
      errorCode: "forbidden",
    });
    state.jobs = [{ kind: "action", state: "failed", errorCode: "x" }];
    await executor.settle(runOf());
    expect(end).toHaveBeenLastCalledWith(expect.anything(), {
      outcome: "failed",
      errorCode: "x",
    });
  });

  it("waits for a job that is still open", async () => {
    state.jobs = [{ kind: "action", state: "queued" }];
    const { executor, end } = fixture();
    await executor.settle(runOf());
    expect(end).not.toHaveBeenCalled();
  });
});
