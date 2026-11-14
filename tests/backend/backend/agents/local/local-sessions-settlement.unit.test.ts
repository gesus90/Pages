import { beforeEach, describe, expect, it, vi } from "vitest";

import { settleManagedLocalOwner } from "@/backend/agents/local/LocalOwnerControl";

import {
  ATTEMPT_ID,
  CLOSED,
  INSTANCE_ID,
  PLAN_ID,
  RUN_ID,
  STEP_ID,
  USER_ID,
  createObserver,
  createSession,
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
  readonly completion: (turnId: string) => Promise<unknown>;
  readonly namespace: (mutation: unknown) => Promise<void>;
}

function sessionInput(): AgentPlanSessionInput {
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
  });
}

function dependencies(): AttachedDependencies {
  return stub<AttachedDependencies>(mocks.attachedArguments[0]?.[3]);
}

async function openOne(): Promise<ReturnType<typeof createSessions>> {
  const sessions = createSessions();
  await sessions.open(
    sessionInput(),
    new AbortController().signal,
    createObserver(),
  );
  return sessions;
}

beforeEach(() => {
  resetMocks();
  const session = createSession();
  resources.open.mockImplementation(async (owner, signal, start) => {
    await start(signal, lifecycle);
    return session;
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
