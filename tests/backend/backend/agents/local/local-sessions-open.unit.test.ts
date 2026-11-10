import { beforeEach, describe, expect, it, vi } from "vitest";

import { settleManagedLocalOwner } from "@/backend/agents/local/LocalOwnerControl";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";

import {
  ATTEMPT_ID,
  CLOSED,
  INSTANCE_ID,
  MANIFEST,
  PLAN_ID,
  PROOF,
  RUN_ID,
  STEP_ID,
  USER_ID,
  createObserver,
  createSession,
  directoryOf,
  entryOf,
  lifecycle,
  mocks,
  rawSessions,
  resetMocks,
  resources,
  stub,
  supervisor,
} from "./local-sessions-fixture";
import { adopt, createSessions } from "./local-sessions-harness";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";

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

const BEARER = "t".repeat(43);

interface AttachedDependencies {
  readonly control: (command: unknown) => Promise<unknown>;
  readonly completion: (turnId: string) => Promise<unknown>;
  readonly nextLaunch: (input: AgentPlanSessionInput) => unknown;
  readonly namespace: (mutation: unknown) => Promise<void>;
}

function sessionInput(
  overrides: Record<string, unknown> = {},
): AgentPlanSessionInput {
  return stub<AgentPlanSessionInput>({
    instanceId: INSTANCE_ID,
    userId: USER_ID,
    prompt: "implement it",
    directory: "/work",
    options: { timeoutMinutes: 45, browser: true },
    mcp: { url: "http://localhost/mcp", tools: ["a", "b"], token: BEARER },
    acceptanceInstruction: "report",
    recording: {
      instanceId: INSTANCE_ID,
      provider: "codex_cli",
      key: {
        planId: PLAN_ID,
        runId: RUN_ID,
        stepId: STEP_ID,
        attemptId: ATTEMPT_ID,
      },
    },
    ...overrides,
  });
}

function dependencies(): AttachedDependencies {
  return stub<AttachedDependencies>(mocks.attachedArguments[0]?.[3]);
}

/** Lets the scheduler run the start callback the way an admitted session would. */
function admitStart(session = createSession()): void {
  resources.open.mockImplementation(async (owner, signal, start) => {
    await start(signal, lifecycle);
    return session;
  });
}

beforeEach(() => {
  resetMocks();
  admitStart();
});

describe("open", () => {
  it("reserves, launches, proves and attaches an owner, then hands the bearer over", async () => {
    const observer = createObserver();
    const beforeStart = vi.fn();
    const scheduled = createSession();
    admitStart(scheduled);
    const sessions = createSessions();
    const signal = new AbortController().signal;

    const session = await sessions.open(
      sessionInput({ beforeStart }),
      signal,
      observer,
    );

    expect(session).toBe(scheduled);
    expect(beforeStart).toHaveBeenCalledOnce();
    expect(resources.open).toHaveBeenCalledWith(
      {
        instanceId: INSTANCE_ID,
        runId: RUN_ID,
        stepId: STEP_ID,
        userId: USER_ID,
        provider: "codex_cli",
      },
      signal,
      expect.any(Function),
      observer,
    );
    expect(lifecycle.trackSpawn).toHaveBeenCalledOnce();
    expect(lifecycle.beforeSpawn).toHaveBeenCalledOnce();
    expect(mocks.records.requireLocalDirectory).toHaveBeenNthCalledWith(
      1,
      directoryOf(INSTANCE_ID).replace(`/${INSTANCE_ID}`, ""),
    );
    expect(mocks.records.requireLocalDirectory).toHaveBeenNthCalledWith(
      2,
      directoryOf(INSTANCE_ID),
    );
    const manifest = mocks.unit.startLocalSessionUnit.mock.calls[0]?.[0];
    expect(manifest).toMatchObject({
      version: 1,
      directory: directoryOf(INSTANCE_ID),
      unit: `pages-local-${INSTANCE_ID}.service`,
      launch: {
        runId: RUN_ID,
        stepId: STEP_ID,
        sessionScopeId: STEP_ID,
        attemptId: ATTEMPT_ID,
        turnId: ATTEMPT_ID,
        isInstruction: false,
        userId: USER_ID,
        prompt: "implement it",
        instruction: "report",
        timeoutMinutes: 45,
        mcp: { url: "http://localhost/mcp", tools: ["a", "b"] },
        resumeSessionId: null,
      },
    });
    expect(manifest.capability).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(manifest)).not.toContain(BEARER);
    expect(mocks.records.writeLocalRecord).toHaveBeenCalledWith(
      `${directoryOf(INSTANCE_ID)}/manifest.json`,
      manifest,
    );
    expect(mocks.owners.create).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: INSTANCE_ID,
        runId: RUN_ID,
        proof: null,
        releasedAt: null,
      }),
    );
    expect(mocks.tools.pinLocalSessionTools).toHaveBeenCalledWith(
      expect.anything(),
      { instanceId: INSTANCE_ID, provider: "codex_cli", browser: true },
    );
    expect(mocks.owners.prove).toHaveBeenCalledWith(INSTANCE_ID, PROOF);
    expect(mocks.transport.sendLocalCommand).toHaveBeenCalledWith(
      MANIFEST,
      { kind: "bearer", token: BEARER },
      expect.stringMatching(/^[a-f0-9-]{36}$/u),
    );
    expect(sessions.has(INSTANCE_ID)).toBe(true);
    expect(sessions.hasRun(RUN_ID)).toBe(true);
  });
});

describe("open wrapping", () => {
  it("returns the scheduler session even when the owner was never started through it", async () => {
    const scheduled = createSession();
    resources.open.mockResolvedValue(scheduled);

    const session = await createSessions().open(
      sessionInput(),
      new AbortController().signal,
      createObserver(),
    );

    expect(session).toBe(scheduled);
    expect(mocks.unit.startLocalSessionUnit).not.toHaveBeenCalled();
  });

  it("detaches the scheduler session wrapped around the raw owner", async () => {
    const scheduled = createSession();
    admitStart(scheduled);
    const sessions = createSessions();
    await sessions.open(
      sessionInput(),
      new AbortController().signal,
      createObserver(),
    );

    sessions.detachAll();

    expect(scheduled.detach).toHaveBeenCalledOnce();
    expect(rawSessions[0]?.detach).not.toHaveBeenCalled();
  });
});

describe("open launch contents", () => {
  it("starts an instruction turn with its own turn id, scope and resume session", async () => {
    const sessions = createSessions();

    await sessions.open(
      sessionInput({
        mcp: null,
        resumeSessionId: "native-1",
        resourceContext: { isLocalInstruction: true, sessionScopeId: "scope" },
        acceptanceInstruction: undefined,
      }),
      new AbortController().signal,
      createObserver(),
    );

    const launch = mocks.unit.startLocalSessionUnit.mock.calls[0]?.[0].launch;
    expect(launch).toMatchObject({
      isInstruction: true,
      sessionScopeId: "scope",
      instruction: "",
      mcp: null,
      resumeSessionId: "native-1",
    });
    expect(launch.turnId).not.toBe(ATTEMPT_ID);
    expect(mocks.transport.sendLocalCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "bearer" }),
      expect.anything(),
    );
  });

  it("keeps an unrestricted tool list as null", async () => {
    await createSessions().open(
      sessionInput({ mcp: { url: "u", tools: null, token: BEARER } }),
      new AbortController().signal,
      createObserver(),
    );

    expect(
      mocks.unit.startLocalSessionUnit.mock.calls[0]?.[0].launch.mcp,
    ).toEqual({ url: "u", tools: null });
  });
});

describe("open refusals", () => {
  it("refuses new work once the instance is shutting down", async () => {
    const sessions = createSessions();
    sessions.detachAll();

    await expect(
      sessions.open(
        sessionInput(),
        new AbortController().signal,
        createObserver(),
      ),
    ).rejects.toMatchObject({ code: "plan_run_unavailable" });
    expect(resources.open).not.toHaveBeenCalled();
  });

  it("refuses a recording that belongs to another instance", async () => {
    await expect(
      createSessions().open(
        sessionInput({
          recording: { instanceId: "other", key: {}, provider: "codex_cli" },
        }),
        new AbortController().signal,
        createObserver(),
      ),
    ).rejects.toMatchObject({ code: "plan_context_changed" });
  });

  it("refuses an invalid launch before reserving anything", async () => {
    await expect(
      createSessions().open(
        sessionInput({ userId: "not-a-uuid" }),
        new AbortController().signal,
        createObserver(),
      ),
    ).rejects.toMatchObject({ code: "plan_local_launch_invalid" });
    expect(mocks.owners.create).not.toHaveBeenCalled();
  });

  it("never launches a second owner for an instance that is already reserved", async () => {
    const sessions = createSessions();
    const signal = new AbortController().signal;
    await sessions.open(sessionInput(), signal, createObserver());

    await expect(
      sessions.open(sessionInput(), signal, createObserver()),
    ).rejects.toMatchObject({ code: "plan_local_owner_unverified" });
    expect(mocks.unit.startLocalSessionUnit).toHaveBeenCalledOnce();
  });

  it("keeps a failed start uncertain and reports unconfirmed cleanup", async () => {
    const failure = new Error("systemd refused");
    mocks.unit.startLocalSessionUnit.mockRejectedValue(failure);
    const sessions = createSessions();

    await expect(
      sessions.open(
        sessionInput(),
        new AbortController().signal,
        createObserver(),
      ),
    ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);

    expect(sessions.unverified()).toEqual(new Set([INSTANCE_ID]));
    expect(sessions.hasRun(RUN_ID)).toBe(false);
    expect(mocks.logger.logCaughtError).toHaveBeenCalledWith(
      "LocalSessions",
      failure,
    );
    expect(mocks.owners.prove).not.toHaveBeenCalled();
  });

  it("treats a failed bearer handover as an unconfirmed start", async () => {
    mocks.transport.sendLocalCommand.mockImplementation(
      async (manifest, command) => {
        if (command.kind === "bearer") throw new Error("socket closed");
        return {};
      },
    );
    const sessions = createSessions();

    await expect(
      sessions.open(
        sessionInput(),
        new AbortController().signal,
        createObserver(),
      ),
    ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);

    expect(sessions.unverified().has(INSTANCE_ID)).toBe(true);
  });
});

async function openOne(): Promise<ReturnType<typeof createSessions>> {
  const sessions = createSessions();
  await sessions.open(
    sessionInput(),
    new AbortController().signal,
    createObserver(),
  );
  return sessions;
}

describe("attached owner dependencies", () => {
  it("routes control commands through the proven manifest and the attach token", async () => {
    await openOne();
    mocks.transport.sendLocalCommand.mockClear();
    mocks.transport.sendLocalCommand.mockResolvedValue({ ok: true });

    const result = await dependencies().control({ kind: "interrupt" });

    expect(result).toEqual({ ok: true });
    const attach = mocks.owners.claim.mock.calls[0]?.[1];
    expect(mocks.transport.sendLocalCommand).toHaveBeenCalledWith(
      MANIFEST,
      { kind: "interrupt" },
      attach,
    );
  });

  it("reports an owner that can no longer be proven as unverified", async () => {
    await openOne();
    const failure = new Error("pid changed");
    mocks.ownership.proveLocalOwner.mockRejectedValue(failure);

    await expect(
      dependencies().control({ kind: "interrupt" }),
    ).rejects.toMatchObject({ code: "plan_local_owner_unverified" });
    expect(mocks.logger.logCaughtError).toHaveBeenCalledWith(
      "LocalSessions",
      failure,
    );
  });

  it("builds the next launch with the same owner, mcp slot and no timeout", async () => {
    await openOne();

    const launch = dependencies().nextLaunch(
      sessionInput({
        prompt: "next step",
        recording: {
          instanceId: INSTANCE_ID,
          provider: "codex_cli",
          key: {
            planId: PLAN_ID,
            runId: RUN_ID,
            stepId: "step-two",
            attemptId: "88888888-8888-4888-8888-888888888888",
          },
        },
      }),
    );

    expect(launch).toMatchObject({
      stepId: "step-two",
      prompt: "next step",
      timeoutMinutes: 0,
      mcp: { url: "http://localhost/mcp", tools: ["a", "b"] },
    });
  });
});

describe("attached owner payloads", () => {
  it("reads a completed turn from the payload file store", async () => {
    await openOne();
    const turn = {
      kind: "turn",
      attemptId: ATTEMPT_ID,
      turnId: ATTEMPT_ID,
      result: {
        output: "done",
        sessionId: null,
        failure: null,
        errorCode: null,
        endedAt: "2026-11-10T10:00:00.000Z",
        permissionDenials: 0,
        effective: {},
        events: [],
      },
    };
    mocks.owners.result.mockResolvedValueOnce("file-ref");
    mocks.files.read.mockResolvedValue(JSON.stringify(turn));

    await expect(dependencies().completion(ATTEMPT_ID)).resolves.toEqual(turn);
    expect(mocks.owners.result).toHaveBeenCalledWith(INSTANCE_ID, ATTEMPT_ID);
    expect(mocks.files.read).toHaveBeenCalledWith("file-ref");
    await expect(dependencies().completion(ATTEMPT_ID)).resolves.toBeNull();
  });

  it("registers a namespace for an active run and always identifies the process", async () => {
    await openOne();
    const namespace = { kind: "pid_namespace" };

    await dependencies().namespace({
      kind: "started",
      details: { namespace, processId: 77 },
    });
    await dependencies().namespace({
      kind: "started",
      details: { processId: 78 },
    });

    expect(resources.registerNamespace).toHaveBeenCalledExactlyOnceWith(
      INSTANCE_ID,
      namespace,
    );
    expect(supervisor.identify).toHaveBeenNthCalledWith(1, INSTANCE_ID, {
      processId: 77,
    });
    expect(supervisor.identify).toHaveBeenNthCalledWith(2, INSTANCE_ID, {
      processId: 78,
    });
  });

  it("does not register a namespace for a run that already ended", async () => {
    mocks.runs.find.mockResolvedValue({ planId: PLAN_ID, status: "succeeded" });
    await openOne();

    await dependencies().namespace({
      kind: "started",
      details: { namespace: { kind: "pid_namespace" }, processId: 5 },
    });

    expect(resources.registerNamespace).not.toHaveBeenCalled();
    expect(supervisor.identify).toHaveBeenCalledWith(INSTANCE_ID, {
      processId: 5,
    });
  });

  it("detaches an attachment that is created while the instance shuts down", async () => {
    const sessions = createSessions();
    mocks.runs.find.mockImplementation(async () => {
      sessions.detachAll();
      return { planId: PLAN_ID, status: "running" };
    });

    await sessions.open(
      sessionInput(),
      new AbortController().signal,
      createObserver(),
    );

    expect(rawSessions[0]?.detach).toHaveBeenCalledOnce();
  });
});

describe("settleManagedLocalOwner", () => {
  function answerCloseout(closed: unknown): void {
    mocks.transport.sendLocalCommand.mockImplementation(
      async (manifest, command) => (command.kind === "close" ? { closed } : {}),
    );
  }

  it("knows nothing about a foreign lease", async () => {
    createSessions();

    await expect(settleManagedLocalOwner("foreign")).resolves.toBeNull();
  });

  it("reports an already released owner as settled without contacting it", async () => {
    mocks.owners.list.mockResolvedValue([
      entryOf({ releasedAt: "2026-11-10T09:00:00.000Z" }),
    ]);
    const sessions = createSessions();
    await sessions.discover();

    await expect(settleManagedLocalOwner(INSTANCE_ID)).resolves.toBe(true);
    expect(mocks.transport.sendLocalCommand).not.toHaveBeenCalled();
  });

  it("attaches, cancels and closes a proven owner once, reusing its token", async () => {
    answerCloseout(CLOSED);
    const sessions = createSessions();
    await adopt(sessions);

    await expect(settleManagedLocalOwner(INSTANCE_ID)).resolves.toBe(true);
    await expect(settleManagedLocalOwner(INSTANCE_ID)).resolves.toBe(true);

    const kinds = mocks.transport.sendLocalCommand.mock.calls.map(
      ([, command]) => command.kind,
    );
    expect(kinds).toEqual(["attach", "cancel", "close", "cancel", "close"]);
  });

  it("reports an unconfirmed closeout as not settled", async () => {
    answerCloseout({ ...CLOSED, isConfirmed: false });
    await adopt(createSessions());

    await expect(settleManagedLocalOwner(INSTANCE_ID)).resolves.toBe(false);
  });

  it("rejects an answer without a closeout", async () => {
    mocks.transport.sendLocalCommand.mockResolvedValue("ok");
    await adopt(createSessions());

    await expect(settleManagedLocalOwner(INSTANCE_ID)).rejects.toThrow(
      "Missing native closeout",
    );
  });

  it("rejects an answer whose closeout does not match the contract", async () => {
    answerCloseout({ isConfirmed: "yes" });
    await adopt(createSessions());

    await expect(settleManagedLocalOwner(INSTANCE_ID)).rejects.toThrow();
  });

  it("refuses to signal an owner that was never proven", async () => {
    mocks.owners.list.mockResolvedValue([entryOf()]);
    mocks.ownership.proveLocalOwner.mockRejectedValue(new Error("unknown"));
    await createSessions().discover();

    await expect(settleManagedLocalOwner(INSTANCE_ID)).rejects.toMatchObject({
      code: "plan_local_owner_unverified",
    });
    expect(mocks.transport.sendLocalCommand).not.toHaveBeenCalled();
  });
});
