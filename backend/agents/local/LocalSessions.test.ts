import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalSessions } from "@/backend/agents/local/LocalSessions";
import { Database } from "@/backend/database/Database";
import { inspectManagedLocalOwner } from "@/backend/agents/local/LocalOwnerControl";
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

describe("construction", () => {
  it("registers the settlement and inspection of its owners", async () => {
    await provenHarness(entry("i1"), entry("i2", { releasedAt: "then" }));
    expect(inspectManagedLocalOwner("i1")).toBe("owned");
    expect(inspectManagedLocalOwner("i2")).toBe("released");
    expect(inspectManagedLocalOwner("other")).toBeNull();
  });
});

describe("discover", () => {
  it("adopts a proven owner and pins the tools of its CLI session", async () => {
    h.find.mockResolvedValue({ id: "run-1" });
    h.results.mockReturnValue([
      {},
      { session: record("other") },
      {
        session: record("i1", {
          requested: {
            ...record("i1").requested,
            options: {
              access: "yolo",
              shell: true,
              web: false,
              timeoutMinutes: 0,
              browser: true,
            },
          },
        }),
      },
    ]);
    const { sessions } = await provenHarness(
      entry("i1"),
      entry("done", { releasedAt: "then" }),
    );
    expect(sessions.has("i1")).toBe(true);
    expect(sessions.has("done")).toBe(false);
    expect(h.prove).toHaveBeenCalledWith("i1", PROOF);
    expect(h.pin).toHaveBeenCalledWith(expect.anything(), {
      instanceId: "i1",
      provider: "codex_cli",
      browser: true,
    });
  });

  it("pins without a browser and skips API and unknown records", async () => {
    h.results.mockReturnValue([{ session: record("i1") }]);
    await provenHarness(entry("i1"));
    expect(h.pin).toHaveBeenCalledWith(expect.anything(), {
      instanceId: "i1",
      provider: "codex_cli",
      browser: false,
    });
    h.pin.mockClear();
    h.results.mockReturnValue([{ session: record("i2", { runner: "api" }) }]);
    await provenHarness(entry("i2"));
    h.find.mockResolvedValue(null);
    await provenHarness(entry("i3"));
    expect(h.pin).not.toHaveBeenCalled();
  });

  it("releases an owner proven ended", async () => {
    h.proveOwner.mockRejectedValue(new Error("gone"));
    h.hasEndedOwner.mockResolvedValue(true);
    const { sessions } = await provenHarness(entry("i1"));
    expect(sessions.hasEnded("i1")).toBe(true);
    expect(sessions.has("i1")).toBe(false);
    expect(sessions.unverified().size).toBe(0);
    expect(h.released).toHaveBeenCalledWith("i1");
  });

  it.each([
    { label: "not proven ended", ended: false, left: 0 },
    { label: "still has workers", ended: true, left: 2 },
  ])("keeps an owner uncertain when it is $label", async ({ ended, left }) => {
    h.proveOwner.mockRejectedValue(new Error("gone"));
    h.hasEndedOwner.mockResolvedValue(ended);
    h.workers.mockResolvedValue(left);
    const { sessions } = await provenHarness(entry("i1"));
    expect(sessions.unverified().has("i1")).toBe(true);
    expect(sessions.hasEnded("i1")).toBe(false);
    expect(h.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent.local_owner.unverified" }),
    );
  });
});

function lastAttached(): AttachedStub {
  const raw = h.created.at(-1);
  if (!raw) throw new Error("No attached session was created");
  return raw;
}

describe("reattach", () => {
  it("binds, adopts and observes an owner once and reads a saved result", async () => {
    const { sessions, adopt } = await provenHarness(entry("i1"));
    const signal = new AbortController().signal;
    h.completion.mockResolvedValue({ kind: "turn" });
    await sessions.reattach(record("i1"), signal, OBSERVER);
    const raw = lastAttached();
    expect(raw.attach).toHaveBeenCalledOnce();
    expect(h.claim).toHaveBeenCalledWith("i1", expect.any(String));
    expect(adopt).toHaveBeenCalledOnce();
    expect(raw.observe).toHaveBeenCalledWith(signal, OBSERVER);
    expect(h.completion).toHaveBeenCalledWith(
      expect.anything(),
      Database.prototype,
      "i1",
      "attempt",
    );
    expect(h.reattached).toHaveBeenCalledWith(raw, { kind: "turn" });
    await sessions.reattach(record("i1"), signal, OBSERVER);
    expect(h.created).toHaveLength(1);
    expect(raw.observe).toHaveBeenCalledTimes(2);
  });

  it("reads no saved result for the current turn or without an attempt", async () => {
    const { sessions } = await provenHarness(entry("i1"));
    const signal = new AbortController().signal;
    await sessions.reattach(record("i1"), signal, OBSERVER, { current: true });
    await sessions.reattach(
      record("i1", { attemptId: undefined }),
      signal,
      OBSERVER,
    );
    expect(h.completion).not.toHaveBeenCalled();
    expect(h.reattached).toHaveBeenCalledWith(lastAttached(), null);
  });

  it("refuses an owner that is not proven", async () => {
    const { sessions } = await provenHarness();
    await expect(
      sessions.reattach(record("i1"), new AbortController().signal, OBSERVER),
    ).rejects.toThrow("could not be proven");
  });

  it("fails when the run is gone", async () => {
    const { sessions } = await provenHarness(entry("i1"));
    h.find.mockResolvedValue(null);
    await expect(
      sessions.reattach(record("i1"), new AbortController().signal, OBSERVER),
    ).rejects.toThrow();
  });

  it("detaches an owner bound after a shutdown detach", async () => {
    const { sessions } = await provenHarness(entry("i1"));
    sessions.detachAll();
    await sessions.reattach(
      record("i1"),
      new AbortController().signal,
      OBSERVER,
    );
    expect(lastAttached().detach).toHaveBeenCalledOnce();
  });
});

describe("attached owner callbacks", () => {
  async function bound(
    run: { status: string } = { status: "running" },
  ): Promise<{ raw: AttachedStub; harness: Harness }> {
    const harness = await provenHarness(entry("i1"));
    h.find.mockResolvedValue({ id: "run-1", planId: "plan", ...run });
    await harness.sessions.reattach(
      record("i1"),
      new AbortController().signal,
      OBSERVER,
    );
    return { raw: lastAttached(), harness };
  }

  it("sends commands with the attachment token and reads completions", async () => {
    const { raw } = await bound();
    await raw.options.control({ kind: "cancel" });
    expect(h.send).toHaveBeenLastCalledWith(
      OWNED.manifest,
      { kind: "cancel" },
      expect.any(String),
    );
    h.completion.mockResolvedValue("done");
    await expect(raw.options.completion("turn")).resolves.toBe("done");
    expect(() => raw.options.nextLaunch()).toThrow();
  });

  it("registers a namespace of an active run and identifies the process", async () => {
    const { raw, harness } = await bound();
    const namespace = { pid: 1 };
    await raw.options.namespace({ details: { namespace, processId: 7 } });
    expect(harness.registerNamespace).toHaveBeenCalledWith("i1", namespace);
  });

  it("registers no namespace when none exists or the run ended", async () => {
    const { raw, harness } = await bound();
    await raw.options.namespace({ details: { processId: null } });
    expect(harness.registerNamespace).not.toHaveBeenCalled();
    const ended = await bound({ status: "succeeded" });
    await ended.raw.options.namespace({
      details: { namespace: { pid: 1 }, processId: 2 },
    });
    expect(ended.harness.registerNamespace).not.toHaveBeenCalled();
  });
});

describe("control and queries", () => {
  it("pauses owners of a run and skips launching and released ones", async () => {
    const { sessions } = await provenHarness(
      entry("i1"),
      entry("i2"),
      entry("i3", { releasedAt: "then" }),
      entry("i4", { runId: "run-2" }),
    );
    markLaunching(sessions, "i2");
    await sessions.setRunPaused("run-1", true);
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.send).toHaveBeenCalledWith(
      OWNED.manifest,
      { kind: "pause", isPaused: true },
      undefined,
    );
    expect(sessions.hasRun("run-1")).toBe(true);
    expect(sessions.hasRun("run-3")).toBe(false);
    h.proveOwner.mockRejectedValue(new Error("gone"));
    const other = await provenHarness(entry("i5", { runId: "run-5" }));
    expect(other.sessions.hasRun("run-5")).toBe(false);
    markLaunching(other.sessions, "i5");
    expect(other.sessions.hasRun("run-5")).toBe(true);
  });

  it("refuses to pause a run with an unproven owner", async () => {
    h.proveOwner.mockRejectedValue(new Error("gone"));
    const { sessions } = await provenHarness(entry("i1"));
    await expect(sessions.setRunPaused("run-1", false)).rejects.toThrow();
  });

  it("reports a failed proof of a command as unverified", async () => {
    const { sessions } = await provenHarness(entry("i1"));
    h.proveOwner.mockRejectedValue(new Error("gone"));
    await expect(sessions.setRunPaused("run-1", true)).rejects.toThrow(
      "could not be proven",
    );
    expect(h.logError).toHaveBeenCalled();
  });

  it("reads shared launches and milestones", async () => {
    const { sessions } = await provenHarness(entry("i1"));
    h.sharedLaunch.mockResolvedValue({ shared: true });
    h.milestones.mockResolvedValue([]);
    await expect(sessions.sharedInput("i1", "turn")).resolves.toEqual({
      shared: true,
    });
    expect(h.sharedLaunch).toHaveBeenCalledWith(
      "/data/i1",
      expect.objectContaining({ instanceId: "i1" }),
      "turn",
    );
    await expect(sessions.milestones("i1")).resolves.toEqual([]);
  });
});
