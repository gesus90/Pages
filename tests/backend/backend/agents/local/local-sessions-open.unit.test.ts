import { beforeEach, describe, expect, it, vi } from "vitest";

import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentError } from "@/backend/error/AgentErrors";
import { safeLogMetadata } from "@/backend/logging/LogRedaction";

import {
  ATTEMPT_ID,
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
  lifecycle,
  mocks,
  rawSessions,
  resetMocks,
  resources,
  stub,
} from "./local-sessions-fixture";
import { createSessions } from "./local-sessions-harness";

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
  readonly nextLaunch: (input: AgentPlanSessionInput) => unknown;
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

describe("open pause queueing", () => {
  it("attaches before delivering a pause queued during owner launch", async () => {
    let resolveLaunch: () => void = () => {};
    const launchPromise = new Promise<void>((resolve) => {
      resolveLaunch = resolve;
    });
    mocks.unit.startLocalSessionUnit.mockImplementationOnce(
      () => launchPromise,
    );
    const sessions = createSessions();
    const opening = sessions.open(
      sessionInput(),
      new AbortController().signal,
      createObserver(),
    );
    await vi.waitFor(() =>
      expect(mocks.unit.startLocalSessionUnit).toHaveBeenCalledOnce(),
    );
    expect(await sessions.suspend(INSTANCE_ID)).toBe(true);
    resolveLaunch();
    await opening;

    const commands = mocks.transport.sendLocalCommand.mock.calls.map(
      (call) => call[1],
    );
    expect(
      commands.findIndex((command) => command.kind === "attach"),
    ).toBeLessThan(commands.findIndex((command) => command.kind === "suspend"));
  });
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
});

describe("open start failures", () => {
  it("keeps a failed start uncertain and reports unconfirmed cleanup", async () => {
    const failure = Object.assign(new TypeError("private process output"), {
      code: "ECONNREFUSED",
      stdout: "private stdout",
      stderr: "private stderr",
      path: "/synthetic/credentials/auth.json",
      env: { PRIVATE_SETTING: "private environment" },
    });
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
    expect(mocks.logger.logEvent).toHaveBeenCalledExactlyOnceWith({
      level: "warn",
      event: "agent.local_owner.start_failed",
      component: "LocalSessions",
      message:
        "Local native owner failed to start; its reservations remain uncertain",
      metadata: {
        runId: RUN_ID,
        stepId: STEP_ID,
        attemptId: ATTEMPT_ID,
        kind: "TypeError",
        code: "ECONNREFUSED",
      },
    });
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

it.each([
  [
    new AgentError("plan_local_launch_invalid"),
    "AgentError",
    "plan_local_launch_invalid",
  ],
  [new Error("private output"), "Error", null],
  ["private rejection", "NonError", null],
  [
    Object.assign(new Error("private output"), {
      code: "/credentials/auth.json",
    }),
    "Error",
    null,
  ],
])("logs only safe failure identifiers for %s", async (failure, kind, code) => {
  mocks.unit.startLocalSessionUnit.mockRejectedValue(failure);

  await expect(
    createSessions().open(
      sessionInput(),
      new AbortController().signal,
      createObserver(),
    ),
  ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);

  const event = mocks.logger.logEvent.mock.calls[0]?.[0];
  expect(event).toMatchObject({
    level: "warn",
    event: "agent.local_owner.start_failed",
  });
  expect(event).not.toHaveProperty("error");
  expect(safeLogMetadata(event?.metadata)).toEqual({
    runId: RUN_ID,
    stepId: STEP_ID,
    attemptId: ATTEMPT_ID,
    kind,
    code,
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
