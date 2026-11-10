import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATTEMPT_ID,
  CLOSED,
  INSTANCE_ID,
  LAUNCH,
  MANIFEST,
  OTHER_INSTANCE_ID,
  PROOF,
  RUN_ID,
  createObserver,
  createSession,
  directoryOf,
  entryOf,
  mocks,
  rawSessions,
  resetMocks,
  resources,
  stub,
} from "./local-sessions-fixture";
import { adopt, createSessions } from "./local-sessions-harness";

import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

vi.mock(
  "@/backend/database/repositories/agent/LocalSessionRepository",
  async () => (await import("./local-sessions-fixture")).factories.repository(),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanRunRepository",
  async () =>
    (await import("./local-sessions-fixture")).factories.runRepository(),
);
vi.mock("@/backend/storage/AgentPayloadFileStore", async () =>
  (await import("./local-sessions-fixture")).factories.payloadStore(),
);
vi.mock("@/backend/logging/Logger", async () =>
  (await import("./local-sessions-fixture")).factories.logger(),
);
vi.mock("@/backend/agents/local/LocalSessionOwnership", async () =>
  (await import("./local-sessions-fixture")).factories.ownership(),
);
vi.mock("@/backend/agents/local/LocalSessionFiles", async () =>
  (await import("./local-sessions-fixture")).factories.records(),
);
vi.mock("@/backend/agents/local/LocalSessionTransport", async () =>
  (await import("./local-sessions-fixture")).factories.transport(),
);
vi.mock("@/backend/agents/local/LocalSessionUnit", async () =>
  (await import("./local-sessions-fixture")).factories.unit(),
);
vi.mock("@/backend/agents/local/LocalSessionTools", async () =>
  (await import("./local-sessions-fixture")).factories.tools(),
);
vi.mock("node:fs/promises", async () =>
  (await import("./local-sessions-fixture")).factories.fsPromises(),
);
vi.mock("@/backend/agents/local/LocalSessionJournal", async () =>
  (await import("./local-sessions-fixture")).factories.journal(),
);
vi.mock("@/backend/agents/local/LocalSessionImport", async () =>
  (await import("./local-sessions-fixture")).factories.importer(),
);
vi.mock("@/backend/agents/local/LocalAttachedSession", async () =>
  (await import("./local-sessions-fixture")).factories.attached(),
);

const TURN_ID = "99999999-9999-4999-8999-999999999999";
const TURN = {
  kind: "turn",
  attemptId: ATTEMPT_ID,
  turnId: ATTEMPT_ID,
  result: {
    output: "native answer",
    sessionId: "native-1",
    failure: null,
    errorCode: null,
    endedAt: "2026-11-10T10:00:00.000Z",
    permissionDenials: 0,
    effective: {},
    events: [],
  },
};

function recordOf(
  attemptId: string | null = ATTEMPT_ID,
): AgentPlanSessionRecord {
  return {
    instanceId: INSTANCE_ID,
    attemptId,
  } as unknown as AgentPlanSessionRecord;
}

function stubInput(): AgentPlanExecutionInput {
  return stub<AgentPlanExecutionInput>({ prompt: "next" });
}

function stubNext(next: unknown): NonNullable<PlanSession["next"]> {
  return stub<NonNullable<PlanSession["next"]>>(next);
}

beforeEach(resetMocks);

describe("reattach", () => {
  it("refuses an instance that was never proven", async () => {
    await expect(
      createSessions().reattach(
        recordOf(),
        new AbortController().signal,
        createObserver(),
      ),
    ).rejects.toMatchObject({ code: "plan_local_owner_unverified" });
  });

  it("binds a proven owner once, adopts it into the scheduler and observes it", async () => {
    const scheduled = createSession();
    resources.adoptSession.mockResolvedValue(scheduled);
    const sessions = createSessions();
    await adopt(sessions);
    const observer = createObserver();
    const signal = new AbortController().signal;

    const first = await sessions.reattach(recordOf(), signal, observer);
    await sessions.reattach(recordOf(), signal, observer);

    expect(rawSessions).toHaveLength(1);
    expect(mocks.attachedArguments[0]?.slice(0, 3)).toEqual([
      LAUNCH,
      signal,
      observer,
    ]);
    expect(resources.adoptSession).toHaveBeenCalledOnce();
    expect(resources.adoptSession).toHaveBeenCalledWith(
      INSTANCE_ID,
      rawSessions[0],
      observer,
    );
    expect(rawSessions[0]?.observe).toHaveBeenCalledTimes(2);
    expect(rawSessions[0]?.observe).toHaveBeenCalledWith(signal, observer);
    expect(first.isDurable).toBe(true);
    expect(first.terminated).toBe(scheduled.terminated);
  });

  it("returns the saved native result when the attempt already completed", async () => {
    mocks.owners.result.mockResolvedValue("file-ref");
    mocks.files.read.mockResolvedValue(JSON.stringify(TURN));
    const sessions = createSessions();
    await adopt(sessions);

    const session = await sessions.reattach(
      recordOf(),
      new AbortController().signal,
      createObserver(),
    );

    await expect(session.turn).resolves.toEqual(TURN.result);
    expect(mocks.owners.result).toHaveBeenCalledWith(INSTANCE_ID, ATTEMPT_ID);
  });
});

describe("reattach results", () => {
  it("follows the live turn when the current attempt is requested or no attempt is saved", async () => {
    const live = createSession();
    resources.adoptSession.mockResolvedValue(live);
    const sessions = createSessions();
    await adopt(sessions);

    const current = await sessions.reattach(
      recordOf(),
      new AbortController().signal,
      createObserver(),
      { current: true },
    );
    const unsaved = await sessions.reattach(
      recordOf(null),
      new AbortController().signal,
      createObserver(),
    );

    expect(current.turn).toBe(live.turn);
    expect(unsaved.turn).toBe(live.turn);
    expect(mocks.owners.result).not.toHaveBeenCalled();
  });

  it("follows the live turn when no native result was committed", async () => {
    const live = createSession();
    resources.adoptSession.mockResolvedValue(live);
    mocks.owners.result.mockResolvedValue(null);
    const sessions = createSessions();
    await adopt(sessions);

    const session = await sessions.reattach(
      recordOf(),
      new AbortController().signal,
      createObserver(),
    );

    expect(session.turn).toBe(live.turn);
  });

  it("does not take a saved result of another kind for the turn", async () => {
    const live = createSession();
    resources.adoptSession.mockResolvedValue(live);
    mocks.owners.result.mockResolvedValue("file-ref");
    mocks.files.read.mockResolvedValue(
      JSON.stringify({ kind: "closed", result: CLOSED }),
    );
    const sessions = createSessions();
    await adopt(sessions);

    const session = await sessions.reattach(
      recordOf(),
      new AbortController().signal,
      createObserver(),
    );

    expect(session.turn).toBe(live.turn);
  });
});

describe("reattach wrapper", () => {
  it("rejects a corrupt saved result", async () => {
    mocks.owners.result.mockResolvedValue("file-ref");
    mocks.files.read.mockResolvedValue(JSON.stringify({ kind: "nonsense" }));
    const sessions = createSessions();
    await adopt(sessions);

    await expect(
      sessions.reattach(
        recordOf(),
        new AbortController().signal,
        createObserver(),
      ),
    ).rejects.toThrow();
  });

  it("delegates close, detach, steer, interrupt and next to the adopted session", async () => {
    const next = vi.fn(async () => "next-turn");
    const live = createSession({
      next: stubNext(next),
      steer: vi.fn(async () => "injected" as const),
      interrupt: vi.fn(async () => true),
      isClosing: true,
      isDetached: true,
    });
    resources.adoptSession.mockResolvedValue(live);
    const sessions = createSessions();
    await adopt(sessions);
    const signal = new AbortController().signal;
    const observer = createObserver();

    const session = await sessions.reattach(recordOf(), signal, observer);

    expect(session.isDetached).toBe(true);
    expect(session.isClosing).toBe(true);
    session.detach?.();
    expect(live.detach).toHaveBeenCalledOnce();
    await expect(session.close()).resolves.toBe(CLOSED);
    await expect(session.steer?.([])).resolves.toBe("injected");
    await expect(session.interrupt?.()).resolves.toBe(true);
    const input = stubInput();
    await expect(session.next?.(input, signal, observer)).resolves.toBe(
      "next-turn",
    );
    expect(next).toHaveBeenCalledWith(input, signal, observer);
  });

  it("answers inactive and false for a runner without steering, and refuses a group step", async () => {
    resources.adoptSession.mockResolvedValue(
      createSession({ isDetached: undefined, isClosing: undefined }),
    );
    const sessions = createSessions();
    await adopt(sessions);

    const session = await sessions.reattach(
      recordOf(),
      new AbortController().signal,
      createObserver(),
    );

    expect(session.isDetached).toBe(false);
    expect(session.isClosing).toBe(false);
    await expect(session.steer?.([])).resolves.toBe("inactive");
    await expect(session.interrupt?.()).resolves.toBe(false);
    expect(() =>
      session.next?.(
        stubInput(),
        new AbortController().signal,
        createObserver(),
      ),
    ).toThrow(
      expect.objectContaining({ code: "plan_group_session_unsupported" }),
    );
  });
});

describe("sharedInput", () => {
  it("answers the current launch when no turn is named", async () => {
    const current = { ...LAUNCH, prompt: "latest" };
    mocks.records.readLocalRecord.mockImplementation(async (file: string) => {
      if (file.endsWith("proof.json")) return PROOF;
      return file.endsWith("current.json") ? current : {};
    });
    const sessions = createSessions();
    await adopt(sessions);

    await expect(sessions.sharedInput(INSTANCE_ID)).resolves.toEqual(current);
  });

  it("answers the manifest launch for its own turn", async () => {
    const sessions = createSessions();
    await adopt(sessions);

    await expect(sessions.sharedInput(INSTANCE_ID, ATTEMPT_ID)).resolves.toBe(
      MANIFEST.launch,
    );
    expect(mocks.records.readLocalRecord).not.toHaveBeenCalledWith(
      expect.stringContaining("turn-"),
    );
  });

  it("reads the stored launch of an earlier turn", async () => {
    const earlier = { ...LAUNCH, turnId: TURN_ID, prompt: "earlier" };
    mocks.records.readLocalRecord.mockImplementation(async (file: string) => {
      if (file.endsWith("proof.json")) return PROOF;
      return file === `${directoryOf(INSTANCE_ID)}/turn-${TURN_ID}.json`
        ? earlier
        : {};
    });
    const sessions = createSessions();
    await adopt(sessions);

    await expect(sessions.sharedInput(INSTANCE_ID, TURN_ID)).resolves.toEqual(
      earlier,
    );
  });

  it("refuses a turn id that could escape the owner directory", async () => {
    const sessions = createSessions();
    await adopt(sessions);

    await expect(
      sessions.sharedInput(INSTANCE_ID, "../../etc/passwd"),
    ).rejects.toMatchObject({ code: "plan_context_changed" });
  });

  it("refuses an unproven instance", async () => {
    await expect(
      createSessions().sharedInput(INSTANCE_ID),
    ).rejects.toMatchObject({ code: "plan_local_owner_unverified" });
  });
});

describe("milestones", () => {
  const position = {
    kind: "position",
    turns: 2,
    attemptId: ATTEMPT_ID,
    turnId: TURN_ID,
  };

  it("restores the committed mutations of the checkpoint file", async () => {
    mocks.owners.list.mockResolvedValue([entryOf({ checkpointFile: "cp-1" })]);
    mocks.files.read.mockResolvedValue(JSON.stringify([position, TURN]));

    await expect(createSessions().milestones(INSTANCE_ID)).resolves.toEqual([
      position,
      TURN,
    ]);
    expect(mocks.files.read).toHaveBeenCalledWith("cp-1");
  });

  it("is empty for an unknown owner or one without a checkpoint", async () => {
    mocks.owners.list.mockResolvedValue([entryOf()]);
    const sessions = createSessions();

    await expect(sessions.milestones(INSTANCE_ID)).resolves.toEqual([]);
    await expect(sessions.milestones(OTHER_INSTANCE_ID)).resolves.toEqual([]);
    expect(mocks.files.read).not.toHaveBeenCalled();
  });

  it("rejects a checkpoint that is not a list", async () => {
    mocks.owners.list.mockResolvedValue([entryOf({ checkpointFile: "cp-1" })]);
    mocks.files.read.mockResolvedValue(JSON.stringify(position));

    await expect(createSessions().milestones(INSTANCE_ID)).rejects.toThrow(
      "Invalid local session checkpoint",
    );
  });

  it("rejects a mutation that violates the contract", async () => {
    mocks.owners.list.mockResolvedValue([entryOf({ checkpointFile: "cp-1" })]);
    mocks.files.read.mockResolvedValue(JSON.stringify([{ kind: "unknown" }]));

    await expect(createSessions().milestones(INSTANCE_ID)).rejects.toThrow();
  });
});

async function attach(live = createSession()): Promise<{
  sessions: ReturnType<typeof createSessions>;
  live: PlanSession;
}> {
  resources.adoptSession.mockResolvedValue(live);
  const sessions = createSessions();
  await adopt(sessions);
  await sessions.reattach(
    recordOf(),
    new AbortController().signal,
    createObserver(),
  );
  return { sessions, live };
}

describe("detaching and finishing", () => {
  it("detaches only the observers of the named run", async () => {
    const { sessions, live } = await attach();

    expect(sessions.detachRun("other-run")).toBe(false);
    expect(live.detach).not.toHaveBeenCalled();
    expect(sessions.detachRun(RUN_ID)).toBe(true);
    expect(live.detach).toHaveBeenCalledOnce();
  });

  it("leaves the observers of other runs attached", async () => {
    mocks.owners.list.mockResolvedValue([
      entryOf({ instanceId: OTHER_INSTANCE_ID, runId: "other-run" }),
      entryOf(),
    ]);
    const sessions = createSessions();
    await sessions.discover();
    const foreign = createSession();
    const own = createSession();
    resources.adoptSession
      .mockResolvedValueOnce(foreign)
      .mockResolvedValueOnce(own);
    for (const instanceId of [OTHER_INSTANCE_ID, INSTANCE_ID])
      await sessions.reattach(
        { instanceId, attemptId: null } as unknown as AgentPlanSessionRecord,
        new AbortController().signal,
        createObserver(),
      );

    expect(sessions.detachRun(RUN_ID)).toBe(true);

    expect(own.detach).toHaveBeenCalledOnce();
    expect(foreign.detach).not.toHaveBeenCalled();
  });

  it("still owns a run whose observer was never attached", async () => {
    const sessions = createSessions();
    await adopt(sessions);

    expect(sessions.detachRun(RUN_ID)).toBe(true);
  });
});

describe("finishRun", () => {
  it("releases an owner after a confirmed close of both sides", async () => {
    const { sessions, live } = await attach();

    await sessions.finishRun(RUN_ID);

    expect(live.close).toHaveBeenCalledOnce();
    expect(mocks.owners.released).toHaveBeenCalledWith(INSTANCE_ID);
    expect(mocks.transport.sendLocalCommand).toHaveBeenCalledWith(
      MANIFEST,
      { kind: "release" },
      expect.any(String),
    );
    expect(sessions.has(INSTANCE_ID)).toBe(false);
  });

  it("keeps the owner when the scheduler closeout is unconfirmed", async () => {
    const { sessions } = await attach(
      createSession({
        close: vi.fn(async () => ({ ...CLOSED, isConfirmed: false })),
      }),
    );

    await sessions.finishRun(RUN_ID);

    expect(mocks.owners.released).not.toHaveBeenCalled();
    expect(sessions.has(INSTANCE_ID)).toBe(true);
  });

  it("keeps the owner while the raw native session is still open", async () => {
    const { sessions, live } = await attach();
    const [raw] = rawSessions;
    if (raw) raw.isClosed = false;

    await sessions.finishRun(RUN_ID);

    expect(live.close).toHaveBeenCalledOnce();
    expect(mocks.owners.released).not.toHaveBeenCalled();
  });

  it("keeps a shutdown-detached owner without closing it", async () => {
    const { sessions, live } = await attach(
      createSession({ isDetached: true }),
    );
    const [raw] = rawSessions;
    if (raw) raw.isClosed = false;

    await sessions.finishRun(RUN_ID);

    expect(live.close).not.toHaveBeenCalled();
    expect(mocks.owners.released).not.toHaveBeenCalled();
  });

  it("releases a detached owner whose native session is already closed", async () => {
    const { sessions } = await attach(createSession({ isDetached: true }));

    await sessions.finishRun(RUN_ID);

    expect(mocks.owners.released).toHaveBeenCalledWith(INSTANCE_ID);
  });

  it("skips owners that have no attached observer", async () => {
    mocks.owners.list.mockResolvedValue([
      entryOf(),
      entryOf({ instanceId: OTHER_INSTANCE_ID, runId: "other-run" }),
    ]);
    const sessions = createSessions();
    await sessions.discover();

    await sessions.finishRun(RUN_ID);
    await sessions.finishRun("other-run");

    expect(mocks.owners.released).not.toHaveBeenCalled();
  });
});
