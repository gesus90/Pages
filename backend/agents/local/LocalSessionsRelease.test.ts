import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalSessions } from "@/backend/agents/local/LocalSessions";
import { Database } from "@/backend/database/Database";
import {
  inspectManagedLocalOwner,
  settleManagedLocalOwner,
} from "@/backend/agents/local/LocalOwnerControl";
import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import { AgentToolUpdateSearch } from "@/backend/service/agents/tools/AgentToolUpdateSearch";

import type { MockInstance } from "vitest";
import type { LocalOwnerProof } from "@/backend/agents/local/LocalSessionContracts";
import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";
import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

interface AttachedOptions {
  readonly control: (command: { kind: string }) => Promise<unknown>;
  readonly completion: (turnId: string) => Promise<unknown>;
  readonly nextLaunch: () => unknown;
  readonly namespace: (mutation: {
    details: { namespace?: unknown; processId: number | null };
  }) => Promise<void>;
}

interface AttachedStub {
  isClosed: boolean;
  isDetached: boolean;
  readonly options: AttachedOptions;
  readonly observer: PlanSessionObserver;
  readonly attach: ReturnType<typeof vi.fn>;
  readonly observe: ReturnType<typeof vi.fn>;
  readonly detach: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
}

const h = vi.hoisted(() => {
  const created: AttachedStub[] = [];
  const state = { isCloseConfirmed: true };
  class AttachedSession {
    public isClosed = false;
    public isDetached = false;
    public readonly options: AttachedOptions;
    public readonly observer: PlanSessionObserver;
    public readonly attach = vi.fn();
    public readonly observe = vi.fn();
    public readonly detach = vi.fn();
    public readonly close = vi.fn(async () => ({
      isConfirmed: state.isCloseConfirmed,
    }));
    public constructor(
      ...args: [unknown, unknown, PlanSessionObserver, AttachedOptions]
    ) {
      this.observer = args[2];
      this.options = args[3];
      created.push(this);
    }
  }
  return {
    created,
    state,
    AttachedSession,
    list: vi.fn(),
    prove: vi.fn(),
    claim: vi.fn(),
    released: vi.fn(),
    find: vi.fn(),
    proveOwner: vi.fn(),
    hasEndedOwner: vi.fn(),
    waitReady: vi.fn(),
    send: vi.fn(),
    currentLaunch: vi.fn(),
    sharedLaunch: vi.fn(),
    milestones: vi.fn(),
    completion: vi.fn(),
    reattached: vi.fn(),
    workers: vi.fn(),
    forced: vi.fn(),
    pin: vi.fn(),
    results: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("@/backend/database/repositories/agent/LocalSessionRepository", () => ({
  LocalSessionRepository: class {
    public list = h.list;
    public prove = h.prove;
    public claim = h.claim;
    public released = h.released;
  },
}));
vi.mock("@/backend/database/repositories/agent/AgentPlanRunRepository", () => ({
  AgentPlanRunRepository: class {
    public find = h.find;
  },
}));
vi.mock("@/backend/agents/local/LocalAttachedSession", () => ({
  LocalAttachedSession: h.AttachedSession,
}));
vi.mock("@/backend/agents/local/LocalSessionJournal", () => ({
  LocalSessionJournal: class {},
}));
vi.mock("@/backend/agents/local/LocalSessionImport", () => ({
  LocalSessionImport: class {},
}));
vi.mock("@/backend/agents/local/LocalSessionOwnership", () => ({
  proveLocalOwner: h.proveOwner,
  hasEndedLocalOwner: h.hasEndedOwner,
}));
vi.mock("@/backend/agents/local/LocalOwnerReady", () => ({
  waitForLocalOwnerReady: h.waitReady,
}));
vi.mock("@/backend/agents/local/LocalSessionTransport", () => ({
  sendLocalCommand: h.send,
}));
vi.mock("@/backend/agents/local/LocalSessionLaunch", () => ({
  localSessionDirectory: (root: string, id: string) => `${root}/${id}`,
  readCurrentLocalLaunch: h.currentLaunch,
  readSharedLocalLaunch: h.sharedLaunch,
  readLocalSessionMilestones: h.milestones,
}));
vi.mock("@/backend/agents/local/LocalSessionCompletion", () => ({
  readLocalCompletion: h.completion,
  createReattachedLocalSession: h.reattached,
}));
vi.mock("@/backend/agents/local/LocalSessionForcedRelease", () => ({
  forgetForcedLocalRun: h.forced,
}));
vi.mock("@/backend/agents/local/LocalSessionTools", () => ({
  pinLocalSessionTools: h.pin,
}));
vi.mock("@/backend/agents/cli/CliWorkerUnit", () => ({
  settleWorkerUnits: h.workers,
}));
vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => ({}),
}));
vi.mock("@/definition/AgentPlanLoopResults", () => ({
  allPlanRunResults: h.results,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: h.log,
  logCaughtError: h.logError,
}));

const PROOF: LocalOwnerProof = {
  instanceKey: "key",
  instanceId: "i1",
  runId: "run-1",
  stepId: "step",
  attemptId: "attempt",
  unit: "unit",
  invocationId: "b".repeat(32),
  boot: "11111111-1111-4111-8111-111111111111",
  uid: 1,
  pid: 2,
  start: 3,
  cgroup: "/c",
  arguments: [],
};
const OWNED = { proof: PROOF, manifest: { unit: "unit" } };
const OBSERVER: PlanSessionObserver = {
  started: () => undefined,
  identified: () => undefined,
};

function entry(
  instanceId: string,
  overrides: Partial<LocalSessionEntry> = {},
): LocalSessionEntry {
  return {
    instanceId,
    instanceKey: "key",
    runId: "run-1",
    stepId: "step",
    attemptId: "attempt",
    manifestDigest: "digest",
    proof: null,
    acknowledgedSequence: 0,
    acknowledgedDigest: "",
    checkpointFile: null,
    releasedAt: null,
    ...overrides,
  };
}

function record(
  instanceId: string,
  overrides: Partial<AgentPlanSessionRecord> = {},
): AgentPlanSessionRecord {
  return {
    runner: "codex_cli",
    mode: "interactive",
    instanceId,
    attemptId: "attempt",
    sessionId: null,
    processId: null,
    startedAt: null,
    turnEndedAt: null,
    endedAt: null,
    exit: null,
    closeout: "pending",
    leftoverProcesses: null,
    resultCode: null,
    requested: {
      runner: "codex_cli",
      connectionId: "c",
      connectionName: "c",
      model: "m",
      reasoningEffort: null,
      options: null,
      unattended: "yes",
      mcp: false,
      directory: null,
    },
    effective: null,
    definition: null,
    contract: null,
    acceptance: null,
    events: [],
    ...overrides,
  };
}

function createTools(): AgentToolManagerService {
  return new AgentToolManagerService({
    files: {
      root: "/tools",
      home: vi.fn(),
      current: vi.fn(),
      candidate: vi.fn(),
      activate: vi.fn(),
      previous: vi.fn(),
      discard: vi.fn(),
      remove: vi.fn(),
      readEnabled: vi.fn(),
      writeEnabled: vi.fn(),
    },
    installer: { install: vi.fn() },
    health: { check: vi.fn() },
    updates: AgentToolUpdateSearch.prototype,
    system: vi.fn(),
  });
}

interface Harness {
  readonly sessions: LocalSessions;
  readonly tools: AgentToolManagerService;
  readonly adopt: MockInstance<AcpResourceScheduler["adoptSession"]>;
  readonly registerNamespace: MockInstance<
    AcpResourceScheduler["registerNamespace"]
  >;
  readonly complete: MockInstance<AcpResourceScheduler["completeAdopted"]>;
}

function createHarness(): Harness {
  const tools = createTools();
  const adopt = vi
    .spyOn(AcpResourceScheduler.prototype, "adoptSession")
    .mockImplementation(async (...[, session]) => session);
  const registerNamespace = vi
    .spyOn(AcpResourceScheduler.prototype, "registerNamespace")
    .mockResolvedValue(undefined);
  const complete = vi
    .spyOn(AcpResourceScheduler.prototype, "completeAdopted")
    .mockResolvedValue(undefined);
  const sessions = new LocalSessions({
    database: Database.prototype,
    configPath: "/config.json",
    dataDirectory: "/data",
    tokenKey: Buffer.from("key"),
    resources: AcpResourceScheduler.prototype,
    tools,
  });
  return { sessions, tools, adopt, registerNamespace, complete };
}

/** Discovers the given entries as independently proven owners. */
async function provenHarness(
  ...entries: readonly LocalSessionEntry[]
): Promise<Harness> {
  const harness = createHarness();
  h.list.mockResolvedValue(entries);
  await harness.sessions.discover();
  return harness;
}

/** Marks an owner as launching; production code never fills this set, so the guard branches need it forced. */
function markLaunching(sessions: LocalSessions, instanceId: string): void {
  const launching: unknown = Reflect.get(sessions, "launching");
  if (!(launching instanceof Set)) throw new Error("Expected a set");
  launching.add(instanceId);
}

beforeEach(() => {
  for (const mock of Object.values(h))
    if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
  h.created.length = 0;
  h.state.isCloseConfirmed = true;
  h.list.mockResolvedValue([]);
  h.proveOwner.mockResolvedValue(OWNED);
  h.send.mockResolvedValue(undefined);
  h.workers.mockResolvedValue(0);
  h.find.mockResolvedValue({ id: "run-1", planId: "plan", status: "running" });
  h.results.mockReturnValue([]);
  h.currentLaunch.mockResolvedValue({ launch: true });
  h.reattached.mockImplementation((session: unknown) => session);
});

function lastAttached(): AttachedStub {
  const raw = h.created.at(-1);
  if (!raw) throw new Error("No attached session was created");
  return raw;
}

describe("suspend and resume", () => {
  it("defers a suspension of an unknown or launching owner", async () => {
    const { sessions } = await provenHarness(entry("i1"));
    await expect(sessions.suspend("unknown")).resolves.toBe(true);
    markLaunching(sessions, "i1");
    await expect(sessions.suspend("i1")).resolves.toBe(true);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("applies a deferred suspension only to a proven owner on resume", async () => {
    const { sessions } = await provenHarness(entry("i1"));
    await sessions.suspend("unknown");
    await expect(sessions.resume("unknown")).resolves.toBe(true);
    expect(h.send).not.toHaveBeenCalled();
    markLaunching(sessions, "i1");
    await sessions.suspend("i1");
    await expect(sessions.resume("i1")).resolves.toBe(true);
    expect(h.send).toHaveBeenCalledWith(
      OWNED.manifest,
      { kind: "resume" },
      undefined,
    );
  });

  it.each([
    [{ changed: true }, true],
    [{ changed: false }, false],
    [{}, false],
    [null, false],
    ["text", false],
    [undefined, false],
  ])("reports %j from the owner as %s", async (response, expected) => {
    const { sessions } = await provenHarness(entry("i1"));
    h.send.mockResolvedValue(response);
    await expect(sessions.suspend("i1")).resolves.toBe(expected);
    await expect(sessions.resume("i1")).resolves.toBe(expected);
  });
});

describe("detaching", () => {
  it("detaches every observer, tolerating sessions without detach", async () => {
    const { sessions } = await provenHarness(entry("i1"), entry("i2"));
    const signal = new AbortController().signal;
    await sessions.reattach(record("i1"), signal, OBSERVER);
    await sessions.reattach(record("i2"), signal, OBSERVER);
    h.created[1]?.detach.mockClear();
    sessions.detachAll();
    expect(h.created[0]?.detach).toHaveBeenCalled();
    expect(h.created[1]?.detach).toHaveBeenCalled();
  });

  it("detaches only the observers of one owned run", async () => {
    const { sessions } = await provenHarness(
      entry("i1"),
      entry("i2"),
      entry("i3", { runId: "run-2" }),
    );
    const signal = new AbortController().signal;
    await sessions.reattach(record("i1"), signal, OBSERVER);
    await sessions.reattach(record("i3"), signal, OBSERVER);
    h.created.forEach((raw) => raw.detach.mockClear());
    expect(sessions.detachRun("run-9")).toBe(false);
    expect(sessions.detachRun("run-1")).toBe(true);
    expect(h.created[0]?.detach).toHaveBeenCalledOnce();
    expect(h.created[1]?.detach).not.toHaveBeenCalled();
  });
});

describe("forgetForcedRun and finishRun", () => {
  it("lets the forced release path release an entry through its owner", async () => {
    const { sessions } = await provenHarness(entry("i1"));
    h.forced.mockImplementation(
      async (
        ...[, context]: [
          string,
          {
            entries: Map<string, LocalSessionEntry>;
            release: (value: LocalSessionEntry) => Promise<void>;
          },
        ]
      ) => {
        for (const value of context.entries.values())
          await context.release(value);
      },
    );
    await sessions.forgetForcedRun("run-1");
    expect(h.forced).toHaveBeenCalledWith("run-1", expect.anything());
    expect(h.send).toHaveBeenCalledWith(
      OWNED.manifest,
      { kind: "release" },
      undefined,
    );
    expect(h.released).toHaveBeenCalledWith("i1");
    expect(sessions.has("i1")).toBe(false);
    expect(inspectManagedLocalOwner("i1")).toBe("released");
  });

  it("releases only confirmed, closed and attached owners of the run", async () => {
    const ids = ["other", "unproven", "bare", "detached", "open", "unclosed"];
    const entries = [
      entry("other", { runId: "run-2" }),
      entry("unproven"),
      ...ids.slice(2).map((id) => entry(id)),
      entry("done"),
    ];
    h.proveOwner.mockImplementation(async (value: LocalSessionEntry) =>
      value.instanceId === "unproven" ? Promise.reject(new Error("x")) : OWNED,
    );
    h.hasEndedOwner.mockResolvedValue(false);
    const { sessions } = await provenHarness(...entries);
    h.proveOwner.mockResolvedValue(OWNED);
    const signal = new AbortController().signal;
    for (const id of ["detached", "open", "unclosed", "done"])
      await sessions.reattach(record(id), signal, OBSERVER);
    const byId = new Map(
      ["detached", "open", "unclosed", "done"].map((id, index) => [
        id,
        h.created[index],
      ]),
    );
    const detached = byId.get("detached");
    if (detached) detached.isDetached = true;
    const open = byId.get("open");
    if (open) open.close.mockResolvedValue({ isConfirmed: false });
    const unclosed = byId.get("unclosed");
    if (unclosed) {
      unclosed.close.mockResolvedValue({ isConfirmed: true });
      unclosed.isClosed = false;
    }
    const done = byId.get("done");
    if (done) {
      done.close.mockResolvedValue({ isConfirmed: true });
      done.isClosed = true;
    }
    h.send.mockClear();
    await sessions.finishRun("run-1");
    expect(h.released).toHaveBeenCalledTimes(1);
    expect(h.released).toHaveBeenCalledWith("done");
  });
});

describe("settleManaged", () => {
  it("knows no foreign owner and treats a released one as settled", async () => {
    await provenHarness(entry("i1", { releasedAt: "then" }));
    await expect(settleManagedLocalOwner("other")).resolves.toBeNull();
    await expect(settleManagedLocalOwner("i1")).resolves.toBe(true);
  });

  it("cancels and closes a proven owner and reports its confirmation", async () => {
    await provenHarness(entry("i1"));
    h.send.mockImplementation(
      async (...[, command]: [unknown, { kind: string }]) =>
        command.kind === "close"
          ? {
              closed: {
                exit: null,
                endedAt: "now",
                leftovers: 0,
                isConfirmed: true,
              },
            }
          : undefined,
    );
    await expect(settleManagedLocalOwner("i1")).resolves.toBe(true);
    const kinds = h.send.mock.calls.map(([, command]) => command.kind);
    expect(kinds).toEqual(["attach", "cancel", "close"]);
    await settleManagedLocalOwner("i1");
    expect(
      h.send.mock.calls.filter(([, c]) => c.kind === "attach"),
    ).toHaveLength(1);
  });

  it.each([[undefined], [null], [{}], ["text"]])(
    "fails on a close result without closeout (%j)",
    async (response) => {
      await provenHarness(entry("i1"));
      h.send.mockResolvedValue(response);
      await expect(settleManagedLocalOwner("i1")).rejects.toThrow(
        "Missing native closeout",
      );
    },
  );

  it("settles a vanished owner as ended and an uncertain one again", async () => {
    await provenHarness(entry("i1"));
    h.proveOwner.mockRejectedValue(new Error("gone"));
    h.hasEndedOwner.mockResolvedValue(true);
    await expect(settleManagedLocalOwner("i1")).resolves.toBe(true);
    expect(h.released).toHaveBeenCalledWith("i1");
    const { sessions } = await provenHarness(entry("i2"));
    expect(sessions.unverified().size).toBe(0);
  });

  it("settles an uncertain owner through its end proof", async () => {
    h.proveOwner.mockRejectedValue(new Error("gone"));
    h.hasEndedOwner.mockResolvedValue(false);
    const { sessions } = await provenHarness(entry("i1"));
    expect(sessions.unverified().has("i1")).toBe(true);
    await expect(settleManagedLocalOwner("i1")).rejects.toThrow();
    h.hasEndedOwner.mockResolvedValue(true);
    await expect(settleManagedLocalOwner("i1")).resolves.toBe(true);
  });
});

describe("settleFinished", () => {
  it("skips runs that are unknown or still active", async () => {
    const { sessions } = await provenHarness(entry("i1"));
    h.find.mockResolvedValue(null);
    await sessions.settleFinished();
    h.find.mockResolvedValue({ id: "run-1", planId: "plan", status: "paused" });
    await sessions.settleFinished();
    expect(h.created).toHaveLength(0);
  });

  it("closes and releases the owner of a finished run", async () => {
    const { sessions, complete } = await provenHarness(entry("i1"));
    h.find.mockResolvedValue({ id: "run-1", planId: "plan", status: "failed" });
    await sessions.settleFinished();
    expect(complete).toHaveBeenCalledWith("i1", { isConfirmed: true });
    const { observer } = lastAttached();
    observer.started({
      mode: "interactive",
      processId: null,
      startedAt: "now",
      arguments: [],
      unattended: "yes",
    });
    observer.identified("session");
    expect(h.released).toHaveBeenCalledWith("i1");
    expect(sessions.has("i1")).toBe(false);
  });

  it("keeps the owner while its closeout is unconfirmed", async () => {
    const { sessions, complete } = await provenHarness(entry("i1"));
    h.find.mockResolvedValue({ id: "run-1", planId: "plan", status: "failed" });
    h.proveOwner.mockResolvedValue(OWNED);
    h.state.isCloseConfirmed = false;
    await sessions.settleFinished();
    expect(complete).toHaveBeenCalledWith("i1", { isConfirmed: false });
    expect(h.released).not.toHaveBeenCalled();
  });

  it("logs a failed settlement and defers a slow one past startup", async () => {
    vi.useFakeTimers();
    try {
      const { sessions } = await provenHarness(entry("i1"), entry("i2"));
      h.find
        .mockRejectedValueOnce(new Error("boom"))
        .mockReturnValueOnce(new Promise(() => undefined));
      const settling = sessions.settleFinished();
      await vi.advanceTimersByTimeAsync(5000);
      await settling;
      expect(h.logError).toHaveBeenCalled();
      expect(h.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "agent.local_owner.settlement_deferred",
        }),
      );
      await expect(settleManagedLocalOwner("i2")).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
