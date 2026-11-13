import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATTEMPT_ID,
  CLOSED,
  DIRECTORY,
  GOOD_TURN,
  INSTANCE_ID,
  STEP_ID,
  appended,
  doubles,
  endlessTurn,
  flush,
  launchOf,
  missing,
  newSession,
  recorderOf,
  resetDoubles,
  runWithAttempt,
  stub,
} from "./local-owner-session-fixture";
import { newOwner } from "./local-owner-session-harness";

import type { LocalOwnerSession } from "@/backend/agents/local/LocalOwnerSession";
import type {
  PlanSession,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";

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

const INVALID = "Invalid local session control file";

beforeEach(resetDoubles);
afterEach(() => {
  vi.useRealTimers();
});

async function startedOwner(
  session: PlanSession = newSession(),
): Promise<LocalOwnerSession> {
  doubles.open.mockResolvedValue(session);
  const owner = newOwner();
  await owner.start();
  await flush();
  return owner;
}

describe("LocalOwnerSession stop polling", () => {
  it.each([
    "failed",
    "cancelled",
    "succeeded",
    "work_done_closeout_open",
    "stopping",
  ])(
    "ends a still-running native agent when its run becomes %s",
    async (status) => {
      const session = newSession({ turn: endlessTurn() });
      await startedOwner(session);
      doubles.findRun.mockResolvedValue({ ...runWithAttempt(), status });

      await vi.advanceTimersByTimeAsync(250);

      expect(doubles.open.mock.calls[0]?.[1]).toHaveProperty("aborted", true);
      expect(session.close).toHaveBeenCalledOnce();
      expect(appended("closed")).toEqual([]);
    },
  );

  it.each(["failed", "cancelled", "replaced", "closeout_failed", "loop_failed"])(
    "ends the orphaned attempt for %s even while its run is active",
    async (reason) => {
      const session = newSession({ turn: endlessTurn() });
      await startedOwner(session);
      const step = {
        id: STEP_ID,
        status: reason === "closeout_failed" ? "running" : reason,
        session: {
          instanceId: INSTANCE_ID,
          attemptId: reason === "replaced" ? "new-attempt" : ATTEMPT_ID,
          closeout: reason === "closeout_failed" ? "failed" : "pending",
        },
      };
      doubles.findRun.mockResolvedValue({
        ...runWithAttempt(),
        steps: reason === "loop_failed" ? [] : [step],
        loops:
          reason === "loop_failed"
            ? [{ iterations: [{ nodes: [{ ...step, status: "failed" }] }] }]
            : [],
      });

      await vi.advanceTimersByTimeAsync(250);

      expect(doubles.open.mock.calls[0]?.[1]).toHaveProperty("aborted", true);
      expect(session.close).toHaveBeenCalledOnce();
    },
  );

  it.each(["running", "pausing", "paused"])(
    "preserves the same running attempt across observer restarts while %s",
    async (status) => {
      const session = newSession({ turn: endlessTurn() });
      await startedOwner(session);
      doubles.findRun.mockResolvedValue({ ...runWithAttempt(), status });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(session.close).not.toHaveBeenCalled();
      expect(doubles.open.mock.calls[0]?.[1]).toHaveProperty("aborted", false);
    },
  );

  it("aborts pending native work before awaiting its closeout and journal drain", async () => {
    let finishTurn: (turn: PlanSessionTurn) => void = () => {};
    const session = newSession({
      turn: new Promise<PlanSessionTurn>((resolve) => {
        finishTurn = resolve;
      }),
    });
    const owner = await startedOwner(session);
    let answerRun: (run: unknown) => void = () => {};
    doubles.findRun.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerRun = resolve;
        }),
    );

    const closing = owner.close();
    expect(doubles.open.mock.calls[0]?.[1]).toHaveProperty("aborted", true);
    await flush();
    expect(session.close).not.toHaveBeenCalled();
    answerRun(runWithAttempt());
    await flush();

    expect(doubles.open.mock.calls[0]?.[1]).toHaveProperty("aborted", true);
    expect(session.close).toHaveBeenCalledOnce();
    expect(appended("closed")).toEqual([]);
    finishTurn({ ...GOOD_TURN, failure: "cancelled" });
    await expect(closing).resolves.toEqual(CLOSED);
    expect(appended("closed")).toHaveLength(1);
  });

  it("cancels when the database reports a requested stop", async () => {
    const session = newSession({ turn: endlessTurn() });
    await startedOwner(session);
    doubles.findRun.mockResolvedValue({ stopRequested: true });

    await vi.advanceTimersByTimeAsync(250);

    expect(doubles.write).toHaveBeenCalledWith(`${DIRECTORY}/cancel.json`, {
      requestedAt: stub<string>(expect.any(String)),
    });
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("cancels when the run disappeared", async () => {
    const session = newSession({ turn: endlessTurn() });
    await startedOwner(session);
    doubles.findRun.mockResolvedValue(null);

    await vi.advanceTimersByTimeAsync(250);

    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("keeps the native session when the stop lookup fails", async () => {
    const session = newSession({ turn: endlessTurn() });
    await startedOwner(session);
    const failure = new Error("database lost");
    doubles.findRun.mockRejectedValue(failure);

    await vi.advanceTimersByTimeAsync(250);

    expect(doubles.logCaughtError).toHaveBeenCalledWith(
      "LocalOwnerSession",
      failure,
    );
    expect(session.close).not.toHaveBeenCalled();
  });

  it("does not poll again while a check is still running", async () => {
    await startedOwner(newSession({ turn: endlessTurn() }));
    let answer: (run: unknown) => void = () => {};
    doubles.findRun.mockClear();
    doubles.findRun.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    await vi.advanceTimersByTimeAsync(750);
    expect(doubles.findRun).toHaveBeenCalledTimes(1);
    answer(runWithAttempt());
    await vi.advanceTimersByTimeAsync(250);

    expect(doubles.findRun).toHaveBeenCalledTimes(2);
  });

  it("stops polling once the owner is closed", async () => {
    const owner = await startedOwner();
    await owner.close();
    doubles.findRun.mockClear();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(doubles.findRun).not.toHaveBeenCalled();
  });
});

describe("LocalOwnerSession next refusals", () => {
  it("does not dispatch another prompt after the durable attempt failed", async () => {
    const session = newSession();
    const owner = await startedOwner(session);
    doubles.findRun.mockResolvedValue({ ...runWithAttempt(), status: "failed" });

    await expect(owner.next(launchOf({ turnId: "turn-2" }))).rejects.toThrow();

    expect(session.next).not.toHaveBeenCalled();
    expect(doubles.write).not.toHaveBeenCalledWith(
      `${DIRECTORY}/turn-turn-2.json`,
      stub(expect.anything()),
    );
  });
  it("rejects a launch of another instance or run", async () => {
    const owner = await startedOwner();

    await expect(
      owner.next(launchOf({ instanceId: "other-instance" })),
    ).rejects.toThrow("Foreign native turn");
    await expect(owner.next(launchOf({ runId: "other-run" }))).rejects.toThrow(
      "Foreign native turn",
    );
  });

  it("accepts a retried request of an already stored turn without a second prompt", async () => {
    const session = newSession();
    const owner = await startedOwner(session);
    const launch = launchOf({ turnId: "turn-2" });
    doubles.read.mockResolvedValue(JSON.parse(JSON.stringify(launch)));

    await owner.next(launch);

    expect(doubles.read).toHaveBeenCalledWith(`${DIRECTORY}/turn-turn-2.json`);
    expect(session.next).not.toHaveBeenCalled();
  });

  it("rejects a stored turn whose request changed", async () => {
    const owner = await startedOwner();
    doubles.read.mockResolvedValue(launchOf({ prompt: "different" }));

    await expect(owner.next(launchOf({ turnId: "turn-2" }))).rejects.toThrow(
      "Native turn request changed",
    );
  });

  it("rethrows an unreadable turn record", async () => {
    const owner = await startedOwner();
    doubles.read.mockRejectedValue(new Error(INVALID));

    await expect(owner.next(launchOf({ turnId: "turn-2" }))).rejects.toThrow(
      INVALID,
    );
  });

  it("rejects a continuation when the runner cannot continue", async () => {
    const owner = await startedOwner(newSession({ next: undefined }));

    await expect(owner.next(launchOf({ turnId: "turn-2" }))).rejects.toThrow(
      "Native session cannot continue",
    );
  });

  it("rejects a continuation while a turn is pending", async () => {
    const owner = await startedOwner(newSession({ turn: endlessTurn() }));

    await expect(owner.next(launchOf({ turnId: "turn-2" }))).rejects.toThrow(
      "Native session cannot continue",
    );
  });

  it("rejects a continuation after the owner started closing", async () => {
    const owner = await startedOwner();
    const closing = owner.close();

    await expect(owner.next(launchOf({ turnId: "turn-2" }))).rejects.toThrow(
      "Native session cannot continue",
    );
    await closing;
  });
});

describe("LocalOwnerSession next", () => {
  it("stores the turn, advances the position and runs the next prompt", async () => {
    const nextTurn: PlanSessionTurn = { ...GOOD_TURN, output: "second" };
    const session = newSession({
      next: vi.fn(() => Promise.resolve(nextTurn)),
    });
    const owner = await startedOwner(session);
    const launch = launchOf({ turnId: "turn-2", prompt: "continue" });
    doubles.prepare.mockResolvedValue({
      recording: { key: { attemptId: ATTEMPT_ID } },
      input: { directory: "/work", prompt: "continue" },
    });

    await owner.next(launch);
    await flush();

    expect(doubles.write).toHaveBeenCalledWith(
      `${DIRECTORY}/turn-turn-2.json`,
      launch,
    );
    expect(doubles.write).toHaveBeenCalledWith(
      `${DIRECTORY}/current.json`,
      launch,
    );
    expect(appended("position").at(-1)).toEqual({
      kind: "position",
      turns: 2,
      attemptId: ATTEMPT_ID,
      turnId: "turn-2",
    });
    expect(session.next).toHaveBeenCalledWith(
      stub(
        expect.objectContaining({
          prompt: "continue",
          journal: doubles.listeners[0],
        }),
      ),
      stub(expect.any(AbortSignal)),
      stub(expect.any(Object)),
    );
    expect(appended("turn").at(-1)).toMatchObject({
      turnId: "turn-2",
      result: { output: "second" },
    });
  });

  it("carries the confirmed context of the shared recorder into the next attempt", async () => {
    const owner = await startedOwner();
    const recorder = recorderOf();
    const model = { value: "model-x", source: "adapter", reportedAt: "t" };
    const reasoning = { value: "high", source: "adapter", reportedAt: "t" };
    recorder.current = {
      ...recorder.current,
      context: { used: 7 },
      confirmedModel: model,
      confirmedReasoning: reasoning,
    };

    await owner.next(launchOf({ turnId: "turn-2" }));

    expect(recorder.bind).toHaveBeenCalledWith(
      stub(
        expect.objectContaining({
          state: "running",
          context: { used: 7 },
          confirmedModel: model,
          confirmedReasoning: reasoning,
        }),
      ),
    );
    expect(doubles.recorders).toHaveLength(1);
  });
});

describe("LocalOwnerSession interrupt", () => {
  it("returns false when there is no session to interrupt", async () => {
    await expect(newOwner().interrupt()).resolves.toBe(false);
  });

  it("returns false when the runner cannot interrupt", async () => {
    const owner = await startedOwner(newSession({ interrupt: undefined }));

    await expect(owner.interrupt()).resolves.toBe(false);
  });

  it("interrupts the running prompt", async () => {
    const session = newSession();
    const owner = await startedOwner(session);

    await expect(owner.interrupt()).resolves.toBe(true);
    expect(session.interrupt).toHaveBeenCalledTimes(1);
  });
});

describe("LocalOwnerSession steer", () => {
  it("steers once per command and stores a durable receipt first", async () => {
    const session = newSession();
    const owner = await startedOwner(session);

    await expect(owner.steer("go left", "cmd-1")).resolves.toBe("injected");

    expect(doubles.read).toHaveBeenCalledWith(`${DIRECTORY}/steer-cmd-1.json`);
    expect(doubles.write).toHaveBeenCalledWith(
      `${DIRECTORY}/steer-cmd-1.json`,
      {
        prompt: "go left",
      },
    );
    expect(session.steer).toHaveBeenCalledWith([
      { type: "text", text: "go left" },
    ]);
  });

  it("does not replay a command whose receipt exists", async () => {
    const session = newSession();
    const owner = await startedOwner(session);
    doubles.read.mockResolvedValue({ prompt: "go left" });

    await expect(owner.steer("go left", "cmd-1")).resolves.toBe("failed");

    expect(session.steer).not.toHaveBeenCalled();
    expect(doubles.write).not.toHaveBeenCalledWith(
      `${DIRECTORY}/steer-cmd-1.json`,
      stub(expect.anything()),
    );
  });

  it("rethrows an unreadable receipt", async () => {
    doubles.read.mockRejectedValue(new Error(INVALID));

    await expect(newOwner().steer("go", "cmd-2")).rejects.toThrow(INVALID);
  });

  it("reports an inactive session when nothing can be steered", async () => {
    doubles.read.mockRejectedValue(missing());

    await expect(newOwner().steer("go", "cmd-3")).resolves.toBe("inactive");
    expect(doubles.write).toHaveBeenCalledWith(
      `${DIRECTORY}/steer-cmd-3.json`,
      {
        prompt: "go",
      },
    );
  });

  it("reports an inactive session when the runner cannot steer", async () => {
    const owner = await startedOwner(newSession({ steer: undefined }));

    await expect(owner.steer("go", "cmd-4")).resolves.toBe("inactive");
  });
});
