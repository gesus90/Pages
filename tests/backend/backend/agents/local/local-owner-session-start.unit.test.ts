import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { UNKNOWN_CONTEXT } from "@/backend/service/agents/sessions/AgentSessionUsage";

import {
  ATTEMPT_ID,
  DIRECTORY,
  CLOSED,
  GOOD_TURN,
  INSTANCE_ID,
  RUN_ID,
  STEP_ID,
  appended,
  attemptStart,
  doubles,
  flush,
  launchOf,
  newSession,
  recorderOf,
  resetDoubles,
  runWithAttempt,
  stub,
} from "./local-owner-session-fixture";
import { newOwner } from "./local-owner-session-harness";

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

const MCP = { url: "http://localhost/mcp", tools: null };

beforeEach(resetDoubles);
afterEach(() => {
  vi.useRealTimers();
});

describe("LocalOwnerSession start", () => {
  it("prepares, dispatches once and journals the position and the finished turn", async () => {
    const owner = newOwner();

    const first = owner.start();
    expect(owner.start()).toBe(first);
    await first;
    await flush();

    expect(doubles.prepare).toHaveBeenCalledTimes(1);
    expect(doubles.prepare).toHaveBeenCalledWith(launchOf(), null);
    expect(doubles.write).toHaveBeenCalledWith(`${DIRECTORY}/dispatch.json`, {
      attemptId: ATTEMPT_ID,
      prompt: "implement it",
      commandId: stub<string>(expect.any(String)),
    });
    expect(appended("position")).toEqual([
      { kind: "position", turns: 1, attemptId: ATTEMPT_ID, turnId: "turn-1" },
    ]);
    expect(doubles.open).toHaveBeenCalledTimes(1);
    const input = stub<{ journal: unknown }>(doubles.open.mock.calls[0]?.[0]);
    expect(input).toMatchObject({ directory: "/work", prompt: "implement it" });
    expect(input.journal).toBe(doubles.listeners[0]);
  });

  it("records the running attempt through the durable outbox", async () => {
    const owner = newOwner();

    await owner.start();
    await flush();

    const recorder = recorderOf();
    expect(recorder.current).toMatchObject({
      state: "idle",
      context: UNKNOWN_CONTEXT,
      workspace: { checked: "workspace" },
      confirmedModel: { value: null, source: null, reportedAt: null },
    });
    expect(recorder.dependencies.store).toBe(doubles.outboxes[0]);
    expect(recorder.note).not.toHaveBeenCalled();
    expect(appended("turn")).toEqual([
      {
        kind: "turn",
        attemptId: ATTEMPT_ID,
        turnId: "turn-1",
        result: GOOD_TURN,
      },
    ]);
  });

  it("closes the owner when the native process terminates", async () => {
    const session = newSession({ terminated: Promise.resolve() });
    doubles.open.mockResolvedValue(session);
    const owner = newOwner();

    await owner.start();
    await flush();

    expect(session.close).toHaveBeenCalledTimes(1);
    expect(appended("closed")).toEqual([{ kind: "closed", result: CLOSED }]);
  });

  it("fails the owner when closing after termination fails", async () => {
    const failure = new Error("terminate failed");
    const session = newSession({ terminated: Promise.reject(failure) });
    doubles.open.mockResolvedValue(session);
    const owner = newOwner();

    await owner.start();
    await flush();

    expect(doubles.logCaughtError).toHaveBeenCalledWith(
      "LocalOwnerSession",
      failure,
    );
    expect(doubles.open.mock.calls[0]?.[1]).toHaveProperty("aborted", true);
    await expect(owner.close()).rejects.toMatchObject({
      code: "plan_history_unavailable",
    });
  });
});

describe("LocalOwnerSession bearer", () => {
  it("hands the bearer to the preparation once it arrived", async () => {
    const owner = newOwner(launchOf({ mcp: MCP }));
    owner.receiveBearer("bearer-token");
    owner.receiveBearer("ignored-second");

    await owner.start();

    expect(doubles.prepare).toHaveBeenCalledWith(
      launchOf({ mcp: MCP }),
      "bearer-token",
    );
  });

  it("waits for a late bearer instead of failing early", async () => {
    const owner = newOwner(launchOf({ mcp: { ...MCP, tools: ["a"] } }));

    const started = owner.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(doubles.prepare).not.toHaveBeenCalled();
    owner.receiveBearer("late-token");
    await started;

    expect(doubles.prepare).toHaveBeenCalledWith(
      launchOf({ mcp: { ...MCP, tools: ["a"] } }),
      "late-token",
    );
    expect(appended("closed")).toEqual([]);
  });

  it("records a startup failure and closes when the bearer never arrives", async () => {
    const owner = newOwner(launchOf({ mcp: MCP }));
    doubles.findRun.mockResolvedValue(runWithAttempt());
    doubles.sessionStart.mockReturnValue(attemptStart());

    const started = owner.start();
    await vi.advanceTimersByTimeAsync(60_000);
    await started;

    expect(doubles.prepare).not.toHaveBeenCalled();
    expect(doubles.open).not.toHaveBeenCalled();
    expect(doubles.sessionStart).toHaveBeenCalledWith(
      {
        run: stub(expect.objectContaining({ id: RUN_ID })),
        step: { step: { id: STEP_ID }, groupId: "group-1" },
        record: stub(expect.objectContaining({ attemptId: ATTEMPT_ID })),
      },
      INSTANCE_ID,
    );
    expect(recorderOf().current).toMatchObject({
      state: "failed",
      workspace: null,
      context: UNKNOWN_CONTEXT,
    });
    expect(recorderOf().note).toHaveBeenCalledWith({
      kind: "error",
      text: "native startup: plan_mcp_unavailable",
    });
    expect(appended("turn")[0]).toMatchObject({
      attemptId: ATTEMPT_ID,
      turnId: "turn-1",
      result: {
        output: "",
        sessionId: null,
        failure: "failed",
        errorCode: "plan_mcp_unavailable",
        events: ["native session startup failed"],
      },
    });
    expect(appended("closed")[0]).toMatchObject({
      result: { isConfirmed: true, leftovers: 0 },
    });
  });
});

describe("LocalOwnerSession startup failures", () => {
  it("uses the generic failure code for a non-agent startup error", async () => {
    doubles.prepare.mockRejectedValue(new Error("disk gone"));
    doubles.findRun.mockResolvedValue(runWithAttempt());
    doubles.sessionStart.mockReturnValue(attemptStart());
    const owner = newOwner();

    await owner.start();

    expect(doubles.logCaughtError).toHaveBeenCalledWith(
      "LocalOwnerSession",
      stub(expect.objectContaining({ message: "disk gone" })),
    );
    expect(recorderOf().note).toHaveBeenCalledWith({
      kind: "error",
      text: "native startup: plan_step_failed",
    });
    expect(appended("turn")[0]).toMatchObject({
      result: { failure: "failed", errorCode: "plan_step_failed" },
    });
  });

  it("fails the start when the failed attempt is not bound to its run", async () => {
    doubles.prepare.mockRejectedValue(new Error("boom"));
    doubles.findRun.mockResolvedValue(null);
    const owner = newOwner();

    await expect(owner.start()).rejects.toThrow(
      "Failed native attempt is not bound to its run",
    );
    await expect(owner.close()).rejects.toMatchObject({
      code: "plan_history_unavailable",
    });
    expect(appended("closed")).toEqual([]);
  });

  it("does not bind a run step of another attempt", async () => {
    doubles.prepare.mockRejectedValue(new Error("boom"));
    doubles.findRun.mockResolvedValue({
      ...runWithAttempt(),
      steps: [{ id: STEP_ID, groupId: null, session: { attemptId: "other" } }],
    });
    const owner = newOwner();

    await expect(owner.start()).rejects.toThrow(
      "Failed native attempt is not bound to its run",
    );
    expect(doubles.sessionStart).not.toHaveBeenCalled();
  });

  it("finds the failed attempt of a loop member", async () => {
    doubles.prepare.mockRejectedValue(new Error("boom"));
    const run = runWithAttempt();
    doubles.findRun.mockResolvedValue({
      ...run,
      steps: [],
      loops: [{ iterations: [{ nodes: run.steps }] }],
    });
    doubles.sessionStart.mockReturnValue(attemptStart());
    const owner = newOwner();

    await owner.start();

    expect(doubles.sessionStart).toHaveBeenCalledTimes(1);
    expect(appended("closed")).toHaveLength(1);
  });

  it("fails the start when no recording can be derived for the failed attempt", async () => {
    doubles.prepare.mockRejectedValue(new Error("boom"));
    doubles.findRun.mockResolvedValue(runWithAttempt());
    doubles.sessionStart.mockReturnValue(null);
    const owner = newOwner();

    await expect(owner.start()).rejects.toThrow(
      "Failed native recording is unavailable",
    );
  });
});

describe("LocalOwnerSession cancelled start", () => {
  it.each(["failed", "cancelled", "succeeded", "stopping"])(
    "refuses native process creation when the run is already %s",
    async (status) => {
      doubles.findRun.mockResolvedValue({ ...runWithAttempt(), status });
      const owner = newOwner();

      await owner.start();

      expect(doubles.open).not.toHaveBeenCalled();
      expect(appended("turn")[0]).toMatchObject({
        result: { failure: "cancelled" },
      });
    },
  );

  it("records a stopped run as cancelled without opening the native session", async () => {
    doubles.findRun.mockResolvedValue({ stopRequested: true });
    const owner = newOwner();

    await owner.start();

    expect(doubles.open).not.toHaveBeenCalled();
    expect(doubles.write).toHaveBeenCalledWith(`${DIRECTORY}/cancel.json`, {
      requestedAt: stub<string>(expect.any(String)),
    });
    expect(recorderOf().note).toHaveBeenCalledWith({
      kind: "error",
      text: "native startup: plan_step_failed",
    });
    expect(appended("turn")[0]).toMatchObject({
      result: { failure: "cancelled", errorCode: "plan_step_failed" },
    });
    expect(appended("closed")).toHaveLength(1);
  });

  it("treats a vanished run like a stop", async () => {
    doubles.findRun.mockResolvedValue(null);
    const owner = newOwner();

    await owner.start();

    expect(doubles.open).not.toHaveBeenCalled();
    expect(appended("turn")[0]).toMatchObject({
      result: { failure: "cancelled" },
    });
  });

  it("cancels a start whose preparation is still running", async () => {
    let finishPrepare: (value: unknown) => void = () => {};
    doubles.prepare.mockReturnValue(
      new Promise((resolve) => {
        finishPrepare = resolve;
      }),
    );
    const owner = newOwner();

    const started = owner.start();
    await flush();
    const cancelled = owner.cancel();
    expect(owner.cancel()).toBe(cancelled);
    await flush();
    finishPrepare({
      recording: { key: { attemptId: ATTEMPT_ID } },
      input: { directory: "/work", prompt: "implement it" },
    });
    await started;
    await cancelled;

    expect(doubles.open).not.toHaveBeenCalled();
    expect(doubles.write).not.toHaveBeenCalledWith(
      `${DIRECTORY}/dispatch.json`,
      stub(expect.anything()),
    );
    expect(appended("turn")[0]).toMatchObject({
      result: { failure: "cancelled" },
    });
    expect(appended("closed")).toHaveLength(1);
  });
});

describe("LocalOwnerSession open failures", () => {
  it("does not confirm a missing session after an unconfirmed cleanup", async () => {
    doubles.open.mockRejectedValue(new AcpCleanupUnconfirmedError());
    const owner = newOwner();

    await owner.start();

    expect(appended("turn")[0]).toMatchObject({
      result: { failure: "failed", errorCode: "plan_closeout_failed" },
    });
    expect(appended("closed")[0]).toMatchObject({
      result: { isConfirmed: false },
    });
  });

  it("confirms a missing session after an ordinary open failure", async () => {
    doubles.open.mockRejectedValue(new Error("spawn failed"));
    const owner = newOwner();

    await owner.start();

    expect(appended("turn")[0]).toMatchObject({
      result: { failure: "failed", errorCode: "plan_step_failed" },
    });
    expect(appended("closed")[0]).toMatchObject({
      result: { isConfirmed: true },
    });
  });
});
