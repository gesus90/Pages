import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  inspectManagedLocalOwner,
  settleManagedLocalOwner,
} from "@/backend/agents/local/LocalOwnerControl";

import {
  CLOSED,
  INSTANCE_ID,
  LAUNCH,
  MANIFEST,
  OTHER_INSTANCE_ID,
  PROOF,
  RUN_ID,
  directoryOf,
  entryOf,
  mocks,
  resetMocks,
  resources,
  rawSessions,
  runOf,
  state,
  stub,
  supervisor,
} from "./local-sessions-fixture";
import { adopt, createSessions } from "./local-sessions-harness";

import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";

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

const worker = vi.hoisted(() => ({ settle: vi.fn<() => Promise<number>>() }));
vi.mock("@/backend/agents/cli/CliWorkerUnit", () => ({
  settleWorkerUnits: worker.settle,
}));
beforeEach(() => {
  resetMocks();
  worker.settle.mockReset().mockResolvedValue(0);
});

describe("discover", () => {
  it("skips released owners but remembers them for lease inspection", async () => {
    mocks.owners.list.mockResolvedValue([
      entryOf({ releasedAt: "2026-11-10T09:00:00.000Z" }),
      entryOf({ instanceId: OTHER_INSTANCE_ID }),
    ]);
    const sessions = createSessions();

    const result = await sessions.discover();

    expect(mocks.ownership.proveLocalOwner).toHaveBeenCalledOnce();
    expect(result.adopted).toEqual(new Set([OTHER_INSTANCE_ID]));
    expect(result.uncertain.size).toBe(0);
    expect(inspectManagedLocalOwner(INSTANCE_ID)).toBe("released");
    expect(inspectManagedLocalOwner(OTHER_INSTANCE_ID)).toBe("owned");
    expect(inspectManagedLocalOwner("unknown")).toBeNull();
    expect(sessions.has(OTHER_INSTANCE_ID)).toBe(true);
    expect(sessions.has(INSTANCE_ID)).toBe(false);
  });

  it("persists the proof of a surviving unit and pins the tools of a native provider", async () => {
    mocks.runs.find.mockResolvedValue(
      runOf("running", {
        instanceId: INSTANCE_ID,
        runner: "claude_code",
        requested: { options: { browser: true } },
      }),
    );
    const sessions = createSessions();

    await adopt(sessions);

    const entry = entryOf();
    expect(mocks.ownership.proveLocalOwner).toHaveBeenCalledWith(
      entry,
      directoryOf(INSTANCE_ID),
    );
    expect(mocks.owners.prove).toHaveBeenCalledWith(INSTANCE_ID, PROOF);
    expect(mocks.tools.pinLocalSessionTools).toHaveBeenCalledWith(
      expect.objectContaining({ supervisor }),
      { instanceId: INSTANCE_ID, provider: "claude_code", browser: true },
    );
    expect(sessions.unverified().size).toBe(0);
  });

  it("does not pin tools for an API record, a foreign record or a missing run", async () => {
    const sessions = createSessions();
    mocks.runs.find.mockResolvedValue(
      runOf("running", { instanceId: INSTANCE_ID, runner: "api" }),
    );
    await adopt(sessions);
    mocks.runs.find.mockResolvedValue(
      runOf("running", { instanceId: OTHER_INSTANCE_ID, runner: "codex_cli" }),
    );
    await adopt(sessions);
    mocks.runs.find.mockResolvedValue(null);
    await adopt(sessions);

    expect(mocks.tools.pinLocalSessionTools).not.toHaveBeenCalled();
    expect(sessions.has(INSTANCE_ID)).toBe(true);
  });

  it("pins the tools without a browser when the request names none", async () => {
    mocks.runs.find.mockResolvedValue(
      runOf("running", {
        instanceId: INSTANCE_ID,
        runner: "codex_cli",
        requested: {},
      }),
    );

    await adopt(createSessions());

    expect(mocks.tools.pinLocalSessionTools).toHaveBeenCalledWith(
      expect.anything(),
      { instanceId: INSTANCE_ID, provider: "codex_cli", browser: false },
    );
  });
});

describe("discover with failing owners", () => {
  it("keeps an unprovable owner uncertain, logs it and continues with the next one", async () => {
    const failure = new Error("pid reused");
    mocks.ownership.proveLocalOwner.mockRejectedValueOnce(failure);
    mocks.owners.list.mockResolvedValue([
      entryOf(),
      entryOf({ instanceId: OTHER_INSTANCE_ID }),
    ]);
    const sessions = createSessions();

    const result = await sessions.discover();

    expect(result.uncertain).toEqual(new Set([INSTANCE_ID]));
    expect(result.adopted).toEqual(new Set([OTHER_INSTANCE_ID]));
    expect(sessions.unverified()).toBe(result.uncertain);
    expect(mocks.owners.prove).toHaveBeenCalledTimes(1);
    expect(mocks.logger.logCaughtError).toHaveBeenCalledWith(
      "LocalSessions",
      failure,
    );
    expect(mocks.logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        event: "agent.local_owner.unverified",
        metadata: { instanceId: INSTANCE_ID, runId: RUN_ID },
      }),
    );
  });

  it("refuses an instance id that is not a uuid before touching the disk", async () => {
    mocks.owners.list.mockResolvedValue([entryOf({ instanceId: "../escape" })]);
    const sessions = createSessions();

    const result = await sessions.discover();

    expect(result.uncertain).toEqual(new Set(["../escape"]));
    expect(mocks.ownership.proveLocalOwner).not.toHaveBeenCalled();
  });
});

describe("discover readiness", () => {
  it("waits for the ready marker of an owner that is still starting", async () => {
    mocks.records.readLocalRecord.mockImplementation(async (file: string) => {
      if (file.endsWith("proof.json")) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return {};
    });
    mocks.watch.mockImplementation(async function* () {
      yield { eventType: "rename", filename: "proof.json" };
      yield { eventType: "rename", filename: "ready.json" };
    });
    const sessions = createSessions();

    await adopt(sessions);

    const [directory, options] = mocks.watch.mock.calls[0] ?? [];
    expect(directory).toBe(directoryOf(INSTANCE_ID));
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(sessions.has(INSTANCE_ID)).toBe(true);
  });

  it("does not adopt an owner whose proof file cannot be read", async () => {
    const failure = Object.assign(new Error("denied"), { code: "EACCES" });
    mocks.records.readLocalRecord.mockRejectedValue(failure);
    const sessions = createSessions();

    await adopt(sessions);

    expect(sessions.has(INSTANCE_ID)).toBe(false);
    expect(sessions.unverified()).toEqual(new Set([INSTANCE_ID]));
    expect(mocks.logger.logCaughtError).toHaveBeenCalledWith(
      "LocalSessions",
      failure,
    );
  });

  it("gives up on an owner that never becomes ready after twenty seconds", async () => {
    vi.useFakeTimers();
    try {
      mocks.records.readLocalRecord.mockRejectedValue(
        Object.assign(new Error("missing"), { code: "ENOENT" }),
      );
      mocks.watch.mockImplementation((directory: string, options) =>
        (async function* () {
          await new Promise<void>((resolve, reject) => {
            options.signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          });
          yield { eventType: "rename", filename: "never" };
        })(),
      );
      const sessions = createSessions();

      const discovery = adopt(sessions);
      await vi.advanceTimersByTimeAsync(19_999);
      expect(sessions.unverified().size).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      await discovery;

      expect(sessions.has(INSTANCE_ID)).toBe(false);
      expect(sessions.unverified().has(INSTANCE_ID)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops watching once the ready marker has been read", async () => {
    let watched: AbortSignal | undefined;
    mocks.watch.mockImplementation((directory: string, options) => {
      watched = options.signal;
      return (async function* () {})();
    });

    await adopt(createSessions());

    expect(watched?.aborted).toBe(true);
  });

  it("rejects a malformed proof file", async () => {
    mocks.records.readLocalRecord.mockResolvedValue({ instanceId: "x" });
    const sessions = createSessions();

    await adopt(sessions);

    expect(sessions.has(INSTANCE_ID)).toBe(false);
    expect(sessions.unverified().has(INSTANCE_ID)).toBe(true);
  });
});

describe("run ownership queries", () => {
  it("reports a run as owned while a proven or launching instance belongs to it", async () => {
    const sessions = createSessions();
    expect(sessions.hasRun(RUN_ID)).toBe(false);

    await adopt(sessions);

    expect(sessions.hasRun(RUN_ID)).toBe(true);
    expect(sessions.hasRun("other-run")).toBe(false);
  });

  it("does not restore a run whose owner could not be proven", async () => {
    mocks.ownership.proveLocalOwner.mockRejectedValue(new Error("gone"));
    const sessions = createSessions();

    await adopt(sessions);

    expect(sessions.hasRun(RUN_ID)).toBe(false);
  });
});

describe("settleFinished", () => {
  it("bounds startup across live orphans and retains capacity until background closeout confirms", async () => {
    vi.useFakeTimers();
    let unblock: (answer: unknown) => void = () => {};
    try {
      mocks.runs.find.mockResolvedValue(runOf("failed"));
      mocks.owners.list.mockResolvedValue([
        entryOf(),
        entryOf({ instanceId: OTHER_INSTANCE_ID }),
      ]);
      const sessions = createSessions();
      await sessions.discover();
      mocks.transport.sendLocalCommand.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            unblock = resolve;
          }),
      );
      let isReady = false;
      const startup = sessions.settleFinished().then(() => {
        isReady = true;
      });

      await vi.advanceTimersByTimeAsync(4_999);
      expect(isReady).toBe(false);
      expect(resources.completeAdopted).toHaveBeenCalledWith(
        OTHER_INSTANCE_ID,
        CLOSED,
      );
      const repeated = sessions.settleFinished();
      await vi.advanceTimersByTimeAsync(1);
      await startup;

      expect(isReady).toBe(true);
      expect(sessions.has(INSTANCE_ID)).toBe(true);
      expect(mocks.owners.released).not.toHaveBeenCalledWith(INSTANCE_ID);
      expect(resources.completeAdopted).not.toHaveBeenCalledWith(
        INSTANCE_ID,
        expect.anything(),
      );
      const controls = mocks.transport.sendLocalCommand.mock.calls.length;
      await expect(settleManagedLocalOwner(INSTANCE_ID)).resolves.toBe(false);
      expect(mocks.transport.sendLocalCommand).toHaveBeenCalledTimes(controls);
      expect(mocks.logger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "agent.local_owner.settlement_deferred",
        }),
      );

      unblock({});
      await vi.advanceTimersByTimeAsync(0);
      await repeated;

      expect(resources.completeAdopted).toHaveBeenCalledWith(
        INSTANCE_ID,
        CLOSED,
      );
      expect(mocks.owners.released).toHaveBeenCalledWith(INSTANCE_ID);
      expect(inspectManagedLocalOwner(INSTANCE_ID)).toBe("released");
    } finally {
      unblock({});
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
  });
});

describe("settleFinished ownership", () => {
  it("imports, closes and releases the owner of a finished run", async () => {
    mocks.runs.find.mockResolvedValue(runOf("succeeded"));
    const sessions = createSessions();
    await adopt(sessions);

    await sessions.settleFinished();

    expect(rawSessions).toHaveLength(1);
    expect(rawSessions[0]?.close).toHaveBeenCalledOnce();
    expect(resources.completeAdopted).toHaveBeenCalledWith(INSTANCE_ID, CLOSED);
    expect(mocks.transport.sendLocalCommand).toHaveBeenCalledWith(
      MANIFEST,
      { kind: "release" },
      expect.any(String),
    );
    expect(mocks.owners.released).toHaveBeenCalledWith(INSTANCE_ID);
    expect(supervisor.release).toHaveBeenCalledWith(INSTANCE_ID);
    expect(sessions.has(INSTANCE_ID)).toBe(false);
    expect(inspectManagedLocalOwner(INSTANCE_ID)).toBe("released");
  });

  it("claims the native attachment with the token it sent to the owner", async () => {
    mocks.runs.find.mockResolvedValue(runOf("failed"));
    const sessions = createSessions();
    await adopt(sessions);

    await sessions.settleFinished();

    const attach = mocks.transport.sendLocalCommand.mock.calls
      .map(([, command]) => command)
      .find((command) => command.kind === "attach");
    const token = attach?.kind === "attach" ? attach.token : "";
    expect(token).toMatch(/^[a-f0-9-]{36}$/u);
    expect(mocks.owners.claim).toHaveBeenCalledWith(INSTANCE_ID, token);
    const observer = stub<PlanSessionObserver>(mocks.attachedArguments[0]?.[2]);
    expect(
      observer.started(stub<Parameters<PlanSessionObserver["started"]>[0]>({})),
    ).toBeUndefined();
    expect(observer.identified("native")).toBeUndefined();
    expect(mocks.journalArguments[0]?.[0]).toBe(directoryOf(INSTANCE_ID));
    expect(mocks.journalArguments[0]?.[1]).toMatch(/^[a-f0-9-]{36}$/u);
  });

  it("leaves the owner alone when the native closeout is not confirmed", async () => {
    mocks.runs.find.mockResolvedValue(runOf("succeeded"));
    state.closed = { ...CLOSED, isConfirmed: false };
    const sessions = createSessions();
    await adopt(sessions);

    await sessions.settleFinished();

    expect(resources.completeAdopted).toHaveBeenCalledWith(
      INSTANCE_ID,
      state.closed,
    );
    expect(mocks.owners.released).not.toHaveBeenCalled();
    expect(sessions.has(INSTANCE_ID)).toBe(true);
  });
});

describe("settleFinished edge cases", () => {
  it("ignores unproven owners, unfinished runs and vanished runs", async () => {
    const sessions = createSessions();
    mocks.owners.list.mockResolvedValue([
      entryOf(),
      entryOf({ instanceId: OTHER_INSTANCE_ID }),
    ]);
    mocks.ownership.proveLocalOwner.mockRejectedValueOnce(new Error("no"));
    await sessions.discover();

    mocks.runs.find.mockResolvedValueOnce(null);
    await sessions.settleFinished();
    mocks.runs.find.mockResolvedValue(runOf("running"));
    await sessions.settleFinished();

    expect(rawSessions).toHaveLength(0);
    expect(mocks.owners.released).not.toHaveBeenCalled();
  });

  it("logs a failing settlement and keeps settling the others", async () => {
    mocks.runs.find.mockResolvedValue(runOf("succeeded"));
    const sessions = createSessions();
    mocks.owners.list.mockResolvedValue([
      entryOf(),
      entryOf({ instanceId: OTHER_INSTANCE_ID }),
    ]);
    await sessions.discover();
    const failure = new Error("socket closed");
    mocks.transport.sendLocalCommand.mockRejectedValueOnce(failure);

    await sessions.settleFinished();

    expect(mocks.logger.logCaughtError).toHaveBeenCalledWith(
      "LocalSessions",
      failure,
    );
    expect(mocks.owners.released).toHaveBeenCalledOnce();
  });

  it("falls back to the launch of the manifest when no turn was written yet", async () => {
    mocks.runs.find.mockResolvedValue(runOf("cancelled"));
    mocks.records.readLocalRecord.mockImplementation(async (file: string) => {
      if (file.endsWith("proof.json")) return PROOF;
      if (file.endsWith("current.json"))
        throw Object.assign(new Error("none"), { code: "ENOENT" });
      return {};
    });
    const sessions = createSessions();
    await adopt(sessions);

    await sessions.settleFinished();

    expect(mocks.attachedArguments[0]?.[0]).toEqual(LAUNCH);
  });

  it("does not hide a damaged current launch file behind the manifest", async () => {
    mocks.runs.find.mockResolvedValue(runOf("cancelled"));
    mocks.records.readLocalRecord.mockImplementation(async (file: string) => {
      if (file.endsWith("proof.json")) return PROOF;
      if (file.endsWith("current.json")) return { runId: "broken" };
      return {};
    });
    const sessions = createSessions();
    await adopt(sessions);

    await sessions.settleFinished();

    expect(rawSessions).toHaveLength(0);
    expect(mocks.logger.logCaughtError).toHaveBeenCalledOnce();
  });

  it("refuses a run that disappeared while binding", async () => {
    mocks.runs.find
      .mockResolvedValueOnce(runOf("running"))
      .mockResolvedValueOnce(runOf("succeeded"))
      .mockResolvedValueOnce(null);
    const sessions = createSessions();
    await adopt(sessions);

    await sessions.settleFinished();

    expect(rawSessions).toHaveLength(0);
    expect(mocks.logger.logCaughtError).toHaveBeenCalledWith(
      "LocalSessions",
      expect.objectContaining({ code: "plan_run_unavailable" }),
    );
  });
});

it("retires a previously unverified dead owner only after worker cleanup, and persists release", async () => {
  mocks.ownership.proveLocalOwner.mockRejectedValue(new Error("gone"));
  const sessions = createSessions();
  await adopt(sessions);
  mocks.ownership.hasEndedLocalOwner.mockResolvedValue(true);
  await expect(settleManagedLocalOwner(INSTANCE_ID)).resolves.toBe(true);
  expect(mocks.ownership.hasEndedLocalOwner).toHaveBeenCalledWith(
    entryOf(),
    directoryOf(INSTANCE_ID),
  );
  expect(worker.settle).toHaveBeenCalledWith(INSTANCE_ID);
  expect(mocks.owners.released).toHaveBeenCalledWith(INSTANCE_ID);
  expect(inspectManagedLocalOwner(INSTANCE_ID)).toBe("released");
  expect(sessions.unverified().has(INSTANCE_ID)).toBe(false);
  expect(mocks.transport.sendLocalCommand).not.toHaveBeenCalled();
});

it.each(["alive", "unreadable", "workers", "write_failed"])(
  "retains an unverified owner and lease evidence when %s",
  async (failure) => {
    mocks.ownership.proveLocalOwner.mockRejectedValue(new Error("unverified"));
    const sessions = createSessions();
    await adopt(sessions);
    mocks.ownership.hasEndedLocalOwner.mockResolvedValue(failure !== "alive");
    if (failure === "unreadable")
      mocks.ownership.hasEndedLocalOwner.mockRejectedValue(
        new Error("private path"),
      );
    if (failure === "workers") worker.settle.mockResolvedValue(1);
    if (failure === "write_failed")
      mocks.owners.released.mockRejectedValue(
        new Error("database unavailable"),
      );
    await settleManagedLocalOwner(INSTANCE_ID).catch(() => false);
    expect(inspectManagedLocalOwner(INSTANCE_ID)).toBe("owned");
    expect(sessions.unverified().has(INSTANCE_ID)).toBe(true);
    expect(mocks.transport.sendLocalCommand).not.toHaveBeenCalled();
  },
);

it("reconciles an initially proven owner that died after discovery without a restart", async () => {
  const sessions = createSessions();
  await adopt(sessions);
  mocks.ownership.proveLocalOwner.mockRejectedValue(new Error("owner exited"));
  mocks.ownership.hasEndedLocalOwner.mockResolvedValue(true);
  await expect(settleManagedLocalOwner(INSTANCE_ID)).resolves.toBe(true);
  expect(mocks.owners.released).toHaveBeenCalledWith(INSTANCE_ID);
  expect(inspectManagedLocalOwner(INSTANCE_ID)).toBe("released");
  expect(mocks.transport.sendLocalCommand).not.toHaveBeenCalled();
});
