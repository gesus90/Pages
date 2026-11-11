import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

import {
  CLOSED,
  DIRECTORY,
  GOOD_TURN,
  appended,
  doubles,
  flush,
  newSession,
  observerOf,
  recorderOf,
  resetDoubles,
  stub,
} from "./local-owner-session-fixture";
import { newOwner } from "./local-owner-session-harness";

import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanContinuationCapabilities } from "@/definition/AgentPlanRecovery";
import type { AgentPlanActivity } from "@/definition/AgentPlanProgress";

vi.mock("@/backend/logging/Logger", async () =>
  (await import("./local-owner-session-fixture")).factories.logger(),
);
vi.mock("@/backend/agents/local/LocalSessionFiles", async () =>
  (await import("./local-owner-session-fixture")).factories.files(),
);
vi.mock("@/backend/service/agents/sessions/AgentSessionWorkspace", async () =>
  (await import("./local-owner-session-fixture")).factories.workspace(),
);
vi.mock("@/backend/service/agents/sessions/AgentSessionAttempts", async () =>
  (await import("./local-owner-session-fixture")).factories.attempts(),
);
vi.mock("@/backend/service/agents/sessions/AgentSessionJournal", async () =>
  (await import("./local-owner-session-fixture")).factories.sessionJournal(),
);
vi.mock("@/backend/service/agents/sessions/AgentSessionRecorder", async () =>
  (await import("./local-owner-session-fixture")).factories.recorder(),
);
vi.mock("@/backend/agents/local/LocalAcpJournalListener", async () =>
  (await import("./local-owner-session-fixture")).factories.listener(),
);
vi.mock("@/backend/agents/local/LocalSessionOutbox", async () =>
  (await import("./local-owner-session-fixture")).factories.outbox(),
);

const SECRET = "sk-abcdefghijklmnopqr";

beforeEach(resetDoubles);
afterEach(() => {
  vi.useRealTimers();
});

describe("LocalOwnerSession observer", () => {
  it("journals sanitized milestones of the native session", async () => {
    const owner = newOwner();
    await owner.start();
    const observer = observerOf();

    observer.started({
      mode: "interactive",
      processId: 42,
      startedAt: "now",
      arguments: ["--flag"],
      unattended: "yes",
    });
    observer.identified("native-7");
    observer.capabilities?.(
      stub<AgentPlanContinuationCapabilities>({
        canResume: true,
        canLoad: false,
        adapter: "codex",
      }),
    );
    observer.progressed?.([`token ${SECRET} used`]);
    observer.activity?.(
      stub<AgentPlanActivity>({ titles: [`open ${SECRET}`], entries: 1 }),
    );
    await flush();

    expect(appended("started")).toEqual([
      {
        kind: "started",
        details: {
          mode: "interactive",
          processId: 42,
          startedAt: "now",
          arguments: ["--flag"],
          unattended: "yes",
        },
      },
    ]);
    expect(appended("identified")).toEqual([
      { kind: "identified", sessionId: "native-7" },
    ]);
    expect(appended("capabilities")).toEqual([
      {
        kind: "capabilities",
        capabilities: { canResume: true, canLoad: false, adapter: "codex" },
      },
    ]);
    expect(appended("progressed")).toEqual([
      { kind: "progressed", events: ["token [redacted] used"] },
    ]);
    expect(appended("activity")).toEqual([
      {
        kind: "activity",
        activity: { titles: ["open [redacted]"], entries: 1 },
      },
    ]);
  });

  it("fails the owner when a milestone cannot be journaled", async () => {
    const session = newSession();
    doubles.open.mockResolvedValue(session);
    const owner = newOwner();
    await owner.start();
    const failure = new Error("journal full");
    doubles.append.mockRejectedValueOnce(failure);

    observerOf().identified("native-8");
    await flush();

    expect(doubles.logCaughtError).toHaveBeenCalledWith(
      "LocalOwnerSession",
      failure,
    );
    expect(session.close).toHaveBeenCalledTimes(1);
    await expect(owner.close()).rejects.toMatchObject({
      code: "plan_history_unavailable",
    });
  });
});

describe("LocalOwnerSession turn result", () => {
  it("sanitizes the output and the events of the final turn", async () => {
    doubles.open.mockResolvedValue(
      newSession({
        turn: Promise.resolve({
          ...GOOD_TURN,
          output: `key ${SECRET}`,
          events: [`event ${SECRET}`],
        }),
      }),
    );
    const owner = newOwner();

    await owner.start();
    await flush();

    expect(appended("turn")[0]).toMatchObject({
      result: {
        output: "key [redacted]",
        events: ["event [redacted]"],
        sessionId: "native-1",
      },
    });
  });

  it("maps a rejected turn to a failed result with the agent error code", async () => {
    doubles.open.mockImplementation(async () =>
      newSession({
        turn: Promise.reject(new AgentError("plan_mcp_unavailable")),
      }),
    );
    const owner = newOwner();

    await owner.start();
    await flush();

    expect(recorderOf().note).toHaveBeenCalledWith({
      kind: "error",
      text: "turn failed: plan_mcp_unavailable",
    });
    expect(recorderOf().current).toMatchObject({ state: "failed" });
    expect(appended("turn")[0]).toMatchObject({
      result: {
        failure: "failed",
        errorCode: "plan_mcp_unavailable",
        events: ["native turn failed"],
      },
    });
  });

  it("maps a rejected turn without an agent error to the generic code", async () => {
    doubles.open.mockImplementation(async () =>
      newSession({ turn: Promise.reject(new Error("crash")) }),
    );
    const owner = newOwner();

    await owner.start();
    await flush();

    expect(appended("turn")[0]).toMatchObject({
      result: { failure: "failed", errorCode: "plan_step_failed" },
    });
  });

  it("marks a cancelled turn as cancelled", async () => {
    doubles.open.mockResolvedValue(
      newSession({
        turn: Promise.resolve({ ...GOOD_TURN, failure: "cancelled" }),
      }),
    );
    const owner = newOwner();

    await owner.start();
    await flush();

    expect(recorderOf().note).toHaveBeenCalledWith({
      kind: "error",
      text: "turn cancelled",
    });
    expect(recorderOf().current).toMatchObject({ state: "cancelled" });
  });

  it("treats a turn with only an error code as failed", async () => {
    doubles.open.mockResolvedValue(
      newSession({
        turn: Promise.resolve({
          ...GOOD_TURN,
          errorCode: "plan_mcp_unavailable",
        }),
      }),
    );
    const owner = newOwner();

    await owner.start();
    await flush();

    expect(recorderOf().note).toHaveBeenCalledWith({
      kind: "error",
      text: "turn failed: plan_mcp_unavailable",
    });
    expect(recorderOf().current).toMatchObject({ state: "failed" });
  });
});

describe("LocalOwnerSession journal faults", () => {
  it("refuses to publish a turn after the history failed", async () => {
    let finishTurn: (turn: PlanSessionTurn) => void = () => {};
    const session = newSession({
      turn: new Promise<PlanSessionTurn>((resolve) => {
        finishTurn = resolve;
      }),
    });
    doubles.open.mockResolvedValue(session);
    const owner = newOwner();
    await owner.start();
    const failure = new Error("history broke");

    const failing = owner.fail(failure);
    finishTurn(GOOD_TURN);
    await failing;
    await flush();

    expect(doubles.logCaughtError).toHaveBeenCalledWith(
      "LocalOwnerSession",
      failure,
    );
    expect(appended("turn")).toEqual([]);
    expect(appended("closed")).toEqual([]);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("fails the owner when the turn record cannot be written", async () => {
    const owner = newOwner();
    const failure = new Error("append failed");
    doubles.append.mockImplementation(async (mutation) => {
      if (mutation.kind === "turn") throw failure;
    });

    await owner.start();
    await flush();

    expect(doubles.logCaughtError).toHaveBeenCalledWith(
      "LocalOwnerSession",
      failure,
    );
    await expect(owner.close()).rejects.toThrow("append failed");
  });

  it("reports the history unavailable after a journal fault", async () => {
    const owner = newOwner();
    await owner.start();
    await flush();

    await owner.fail(new Error("fault"));

    await expect(owner.close()).rejects.toMatchObject({
      code: "plan_history_unavailable",
    });
  });
});

describe("LocalOwnerSession close", () => {
  it("closes the native session once and ends an idle attempt", async () => {
    const session = newSession();
    doubles.open.mockResolvedValue(session);
    const owner = newOwner();
    await owner.start();
    await flush();

    const closing = owner.close();
    expect(owner.close()).toBe(closing);
    await expect(closing).resolves.toBe(CLOSED);

    expect(session.close).toHaveBeenCalledTimes(1);
    expect(recorderOf().current).toMatchObject({ state: "ended" });
    expect(appended("closed")).toEqual([{ kind: "closed", result: CLOSED }]);
  });

  it("keeps a cancelled attempt state when closing", async () => {
    doubles.open.mockResolvedValue(
      newSession({
        turn: Promise.resolve({ ...GOOD_TURN, failure: "cancelled" }),
      }),
    );
    const owner = newOwner();
    await owner.start();
    await flush();

    await owner.close();

    expect(recorderOf().current).toMatchObject({ state: "cancelled" });
  });

  it("keeps a failed attempt state when closing", async () => {
    doubles.open.mockResolvedValue(
      newSession({
        turn: Promise.resolve({
          ...GOOD_TURN,
          errorCode: "plan_mcp_unavailable",
        }),
      }),
    );
    const owner = newOwner();
    await owner.start();
    await flush();

    await owner.close();

    expect(recorderOf().current).toMatchObject({ state: "failed" });
  });

  it("marks the run as cancelled when a stop is requested at closeout", async () => {
    const owner = newOwner();
    await owner.start();
    await flush();
    doubles.findRun.mockResolvedValue({ stopRequested: true });

    await owner.close();

    expect(doubles.write).toHaveBeenCalledWith(`${DIRECTORY}/cancel.json`, {
      requestedAt: stub<string>(expect.any(String)),
    });
  });

  it("cancels by recording the stop and closing", async () => {
    let finishTurn: (turn: PlanSessionTurn) => void = () => {};
    const session = newSession({
      turn: new Promise<PlanSessionTurn>((resolve) => {
        finishTurn = resolve;
      }),
      close: vi.fn(async () => {
        finishTurn({ ...GOOD_TURN, failure: "cancelled" });
        return CLOSED;
      }),
    });
    doubles.open.mockResolvedValue(session);
    const owner = newOwner();
    await owner.start();
    await flush();

    await owner.cancel();

    expect(doubles.write).toHaveBeenCalledWith(`${DIRECTORY}/cancel.json`, {
      requestedAt: stub<string>(expect.any(String)),
    });
    expect(doubles.open.mock.calls[0]?.[1]).toHaveProperty("aborted", true);
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
