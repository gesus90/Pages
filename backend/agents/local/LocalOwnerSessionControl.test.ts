import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LocalOwnerSession } from "@/backend/agents/local/LocalOwnerSession";
import { localDeferred } from "@/backend/agents/local/LocalDeferred";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

import type { Mock } from "vitest";
import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { LocalSessionLaunch } from "@/backend/agents/local/LocalSessionContracts";
import type { LocalDeferred } from "@/backend/agents/local/LocalDeferred";

interface FakeRecorder {
  current: Record<string, unknown>;
  readonly note: Mock<(note: unknown) => void>;
}

const h = vi.hoisted(() => ({
  wait: vi.fn<() => Promise<void>>(),
  controlNamespace: vi.fn<(owner: unknown, action: string) => Promise<void>>(),
  logCaught: vi.fn<(component: string, error: unknown) => void>(),
  checkWorkspace: vi.fn<() => Promise<unknown>>(),
  sessionStart: vi.fn<() => unknown>(),
  canContinue: vi.fn<() => boolean>(),
  allResults: vi.fn<() => unknown[]>(),
  read: vi.fn<(file: string) => Promise<unknown>>(),
  write: vi.fn<(file: string, value: unknown) => Promise<void>>(),
  recorders: [] as FakeRecorder[],
}));

vi.mock("node:timers/promises", () => ({ setTimeout: h.wait }));
vi.mock("@/backend/agents/cli/CliNamespaceControl", () => ({
  controlOwnedNamespace: h.controlNamespace,
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: h.logCaught }));
vi.mock("@/backend/service/agents/sessions/AgentSessionJournal", () => ({
  AgentSessionJournal: class {},
}));
vi.mock("@/backend/service/agents/sessions/AgentSessionUsage", () => ({
  UNKNOWN_CONTEXT: { unknown: true },
}));
vi.mock("@/backend/service/agents/sessions/AgentSessionWorkspace", () => ({
  checkSessionWorkspace: h.checkWorkspace,
}));
vi.mock("@/backend/service/agents/AgentPlanOutput", () => ({
  sanitizePlanOutput: (text: string): string => `clean:${text}`,
}));
vi.mock("@/backend/service/agents/sessions/AgentSessionAttempts", () => ({
  sessionStart: h.sessionStart,
}));
vi.mock("@/definition/AgentPlanLoopResults", () => ({
  allPlanRunResults: h.allResults,
}));
vi.mock("@/backend/agents/local/LocalOwnerRunAuthorization", () => ({
  canContinueLocalTurn: h.canContinue,
}));
vi.mock("@/backend/agents/local/LocalSessionOutbox", () => ({
  LocalSessionOutbox: class {},
}));
vi.mock("@/backend/agents/local/LocalAcpJournalListener", () => ({
  LocalAcpJournalListener: class {
    public readonly drained = vi.fn(async () => undefined);
  },
}));
vi.mock("@/backend/agents/local/LocalSessionFiles", () => ({
  readLocalRecord: h.read,
  writeLocalRecord: h.write,
}));
vi.mock("@/backend/service/agents/sessions/AgentSessionRecorder", () => ({
  AgentSessionRecorder: class {
    public current: Record<string, unknown>;
    public readonly note = vi.fn();
    public readonly settled = vi.fn(async () => undefined);
    public readonly drained = vi.fn(async () => undefined);

    public constructor(...[, attempt]: [unknown, Record<string, unknown>]) {
      this.current = attempt;
      h.recorders.push(this);
    }

    /** Takes the attempt a later turn binds. */
    public bind(attempt: Record<string, unknown>): void {
      this.current = attempt;
    }

    /** Takes the revised attempt. */
    public revise(attempt: Record<string, unknown>): void {
      this.current = attempt;
    }
  },
}));

const IDS = {
  run: "00000000-0000-4000-8000-000000000001",
  attempt: "00000000-0000-4000-8000-000000000002",
  instance: "00000000-0000-4000-8000-000000000003",
  turn: "00000000-0000-4000-8000-000000000004",
  user: "00000000-0000-4000-8000-000000000005",
  nextTurn: "00000000-0000-4000-8000-000000000006",
};
const CLOSED: PlanSessionClosed = {
  exit: null,
  endedAt: "2026-01-01T00:00:00.000Z",
  leftovers: 0,
  isConfirmed: true,
};

/** Stands in for a collaborator whose full type is irrelevant to the test. */
function double(value: unknown): never {
  return value as never;
}

function launchOf(
  overrides: Partial<LocalSessionLaunch> = {},
): LocalSessionLaunch {
  return {
    runId: IDS.run,
    stepId: "step",
    sessionScopeId: "scope",
    attemptId: IDS.attempt,
    turnId: IDS.turn,
    isInstruction: false,
    instanceId: IDS.instance,
    userId: IDS.user,
    prompt: "prompt",
    instruction: "",
    resumeSessionId: null,
    timeoutMinutes: 0,
    mcp: null,
    ...overrides,
  };
}

function turnOf(overrides: Partial<PlanSessionTurn> = {}): PlanSessionTurn {
  return {
    output: "answer",
    sessionId: "native",
    failure: null,
    errorCode: null,
    endedAt: "2026-01-01T00:00:00.000Z",
    permissionDenials: 0,
    effective: {},
    events: ["event"],
    ...overrides,
  };
}

interface Rig {
  readonly owner: LocalOwnerSession;
  readonly append: Mock<(mutation: unknown) => Promise<void>>;
  readonly find: Mock<() => Promise<unknown>>;
  readonly open: Mock<() => Promise<PlanSession>>;
  readonly prepare: Mock<
    (launch: unknown, bearer: unknown) => Promise<unknown>
  >;
  readonly turn: LocalDeferred<PlanSessionTurn>;
  readonly session: PlanSession;
  readonly close: Mock<() => Promise<PlanSessionClosed>>;
  readonly state: { observer: PlanSessionObserver | null };
}

function rig(
  launch: LocalSessionLaunch = launchOf(),
  extra: Partial<PlanSession> = {},
  provider = "claude_code",
): Rig {
  const turn = localDeferred<PlanSessionTurn>();
  const close = vi.fn(async () => {
    turn.resolve(turnOf());
    return CLOSED;
  });
  const session: PlanSession = { turn: turn.promise, close, ...extra };
  const append = vi.fn(async () => undefined);
  const find = vi.fn(async () => ({ status: "running" }));
  const prepare = vi.fn(async () => ({
    recording: { key: { attemptId: IDS.attempt }, provider },
    input: { directory: "/work", options: { a: 1 } },
  }));
  const state: Rig["state"] = { observer: null };
  const open = vi.fn(async (...[, , observer]: unknown[]) => {
    state.observer = double(observer);
    return session;
  });
  const owner = new LocalOwnerSession(
    double({ directory: "/owner", launch }),
    double({ append }),
    double({
      database: {},
      runs: { find },
      preparation: { prepare },
      execution: { open },
    }),
  );
  return { owner, append, find, open, prepare, turn, session, close, state };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1)
    await vi.advanceTimersByTimeAsync(0);
}

function missing(): Error {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function appended(target: Rig, kind: string): readonly unknown[] {
  return target.append.mock.calls
    .map(([entry]) => entry)
    .filter(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "kind" in entry &&
        entry.kind === kind,
    );
}

beforeEach(() => {
  vi.useFakeTimers();
  h.recorders.length = 0;
  for (const mock of Object.values(h))
    if ("mockReset" in mock) mock.mockReset();
  h.wait.mockResolvedValue(undefined);
  h.controlNamespace.mockResolvedValue(undefined);
  h.checkWorkspace.mockResolvedValue({ checked: true });
  h.canContinue.mockReturnValue(true);
  h.allResults.mockReturnValue([
    { id: "step", groupId: "group", session: { attemptId: IDS.attempt } },
  ]);
  h.sessionStart.mockReturnValue({ key: { attemptId: IDS.attempt } });
  h.read.mockRejectedValue(missing());
  h.write.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

it("waits for a gate that suspend installs and resume lifts", async () => {
  const target = rig();
  await expect(target.owner.suspend()).resolves.toBe(true);
  await expect(target.owner.suspend()).resolves.toBe(true);
  const starting = target.owner.start();
  await settle();
  expect(target.open).not.toHaveBeenCalled();
  await expect(target.owner.resume()).resolves.toBe(true);
  await starting;
  expect(target.open).toHaveBeenCalledOnce();
});

it("waits for a gate installed while the dispatch is recorded", async () => {
  const target = rig();
  h.write.mockImplementation(async (file: string) => {
    if (file.endsWith("dispatch.json")) void target.owner.suspend();
  });
  const starting = target.owner.start();
  await settle();
  expect(target.open).not.toHaveBeenCalled();
  await target.owner.resume();
  await starting;
  expect(target.open).toHaveBeenCalledOnce();
});

it("is cancelled when the owner closes while it waits at the gate", async () => {
  const target = rig();
  await target.owner.suspend();
  const starting = target.owner.start();
  await settle();
  const closing = target.owner.close();
  await settle();
  await target.owner.resume();
  await starting;
  await closing;
  expect(target.open).not.toHaveBeenCalled();
  expect(appended(target, "turn")).toMatchObject([
    { result: { failure: "cancelled" } },
  ]);
});

it("is cancelled when Stop arrives while the gate holds the start", async () => {
  const target = rig();
  await target.owner.suspend();
  const starting = target.owner.start();
  await settle();
  await target.owner.cancel();
  await starting;
  expect(target.open).not.toHaveBeenCalled();
  expect(h.write).toHaveBeenCalledWith("/owner/cancel.json", expect.anything());
});

it("is cancelled when Stop arrives before the run is read again", async () => {
  const target = rig();
  const release = localDeferred<void>();
  let cancelWrites = 0;
  h.write.mockImplementation(async (file: string) => {
    if (file.endsWith("dispatch.json")) void target.owner.cancel();
    if (file.endsWith("cancel.json") && cancelWrites++ === 0)
      await release.promise;
  });
  await target.owner.start();
  release.resolve();
  await settle();
  expect(target.open).not.toHaveBeenCalled();
});

it("is cancelled when the run no longer allows the turn", async () => {
  const target = rig();
  h.canContinue.mockReturnValue(false);
  await target.owner.start();
  expect(target.open).not.toHaveBeenCalled();
  expect(h.write).toHaveBeenCalledWith("/owner/cancel.json", expect.anything());
});

it("starts when the run record is already gone but still allowed", async () => {
  const target = rig();
  target.find.mockResolvedValue(null);
  await target.owner.start();
  expect(target.open).toHaveBeenCalledOnce();
});

it("waits while the run is paused and starts after the resume", async () => {
  const target = rig();
  target.find.mockResolvedValue({ status: "paused" });
  h.wait.mockImplementation(async () => {
    await target.owner.setPaused(false);
  });
  await target.owner.start();
  expect(h.wait).toHaveBeenCalled();
  expect(target.open).toHaveBeenCalledOnce();
});

it("stops waiting for a paused run when Stop arrives", async () => {
  const target = rig();
  target.find.mockResolvedValue({ status: "paused" });
  h.wait.mockImplementation(async () => {
    void target.owner.cancel();
  });
  await target.owner.start();
  expect(target.open).not.toHaveBeenCalled();
  expect(appended(target, "turn")).toMatchObject([
    { result: { failure: "cancelled" } },
  ]);
});

it("freezes a session that opens while a pause arrives", async () => {
  const setPaused = vi.fn(async () => undefined);
  const target = rig(launchOf(), { setPaused });
  target.open.mockImplementation(async () => {
    await target.owner.setPaused(true);
    return target.session;
  });
  await target.owner.start();
  expect(setPaused).toHaveBeenCalledWith(true);
  const plain = rig();
  plain.open.mockImplementation(async () => {
    await plain.owner.setPaused(true);
    return plain.session;
  });
  await plain.owner.start();
  expect(plain.open).toHaveBeenCalledOnce();
});

it("changes the pause through the session", async () => {
  const setPaused = vi.fn(async () => undefined);
  const target = rig(launchOf(), { setPaused });
  await target.owner.setPaused(false);
  expect(setPaused).not.toHaveBeenCalled();
  await target.owner.start();
  await target.owner.setPaused(true);
  expect(setPaused).toHaveBeenCalledWith(true);
  const unsupported = rig();
  await unsupported.owner.start();
  await expect(unsupported.owner.setPaused(true)).rejects.toThrow(
    "Session pause unavailable",
  );
});

it("suspends and resumes the adapter", async () => {
  const target = rig(launchOf(), {
    suspend: vi.fn(async () => true),
    resume: vi.fn(async () => true),
  });
  await expect(target.owner.resume()).resolves.toBe(false);
  await target.owner.start();
  await expect(target.owner.suspend()).resolves.toBe(true);
  await expect(target.owner.resume()).resolves.toBe(true);
  const plain = rig();
  await plain.owner.start();
  await expect(plain.owner.suspend()).resolves.toBe(false);
  await expect(plain.owner.resume()).resolves.toBe(false);
});

it("resumes the adapter after a gate was lifted", async () => {
  const target = rig(launchOf(), { resume: vi.fn(async () => true) });
  await target.owner.start();
  Reflect.set(target.owner, "pauseGate", localDeferred<void>());
  await expect(target.owner.resume()).resolves.toBe(true);
});

it("interrupts the running prompt", async () => {
  const target = rig(launchOf(), { interrupt: vi.fn(async () => true) });
  await expect(target.owner.interrupt()).resolves.toBe(false);
  await target.owner.start();
  await expect(target.owner.interrupt()).resolves.toBe(true);
  const plain = rig();
  await plain.owner.start();
  await expect(plain.owner.interrupt()).resolves.toBe(false);
});

it("steers once per command", async () => {
  const steer = vi.fn(async () => "injected" as const);
  const target = rig(launchOf(), { steer });
  await expect(target.owner.steer("go", "c1")).resolves.toBe("inactive");
  await target.owner.start();
  await expect(target.owner.steer("go", "c2")).resolves.toBe("injected");
  expect(h.write).toHaveBeenCalledWith("/owner/steer-c2.json", {
    prompt: "go",
  });
  expect(steer).toHaveBeenCalledWith([{ type: "text", text: "go" }]);
  const plain = rig();
  await plain.owner.start();
  await expect(plain.owner.steer("go", "c3")).resolves.toBe("inactive");
  h.read.mockResolvedValue({});
  await expect(target.owner.steer("go", "c2")).resolves.toBe("failed");
  h.read.mockRejectedValue(new Error("unreadable"));
  await expect(target.owner.steer("go", "c4")).rejects.toThrow("unreadable");
  h.read.mockRejectedValue("plain");
  await expect(target.owner.steer("go", "c5")).rejects.toBe("plain");
});

it("cancels once and closes the session", async () => {
  const target = rig();
  await target.owner.start();
  const first = target.owner.cancel();
  expect(target.owner.cancel()).toBe(first);
  await first;
  expect(target.close).toHaveBeenCalledOnce();
});

it("closes a session that is still opening", async () => {
  const target = rig();
  const opening = localDeferred<PlanSession>();
  target.open.mockReturnValue(opening.promise);
  const starting = target.owner.start();
  await settle();
  const closing = target.owner.close();
  await settle();
  opening.reject(new AcpCleanupUnconfirmedError());
  await starting.catch(() => undefined);
  await expect(closing).resolves.toMatchObject({ isConfirmed: false });
});

it("confirms a close after another opening failure", async () => {
  const target = rig();
  const opening = localDeferred<PlanSession>();
  target.open.mockReturnValue(opening.promise);
  const starting = target.owner.start();
  await settle();
  const closing = target.owner.close();
  await settle();
  opening.reject(new Error("open"));
  await starting;
  await expect(closing).resolves.toMatchObject({ isConfirmed: true });
});

it("cancels a pending turn when the owner closes", async () => {
  const target = rig();
  await target.owner.start();
  await target.owner.close();
  expect(h.write).toHaveBeenCalledWith("/owner/cancel.json", expect.anything());
});

it("cancels the closing owner of a run that may no longer continue", async () => {
  const target = rig();
  await target.owner.start();
  target.turn.resolve(turnOf());
  await settle();
  h.canContinue.mockReturnValue(false);
  await target.owner.close();
  expect(h.write).toHaveBeenCalledWith("/owner/cancel.json", expect.anything());
});

async function started(extra: Partial<PlanSession> = {}): Promise<Rig> {
  const target = rig(launchOf(), {
    next: vi.fn(async () => turnOf()),
    ...extra,
  });
  await target.owner.start();
  target.turn.resolve(turnOf());
  await settle();
  return target;
}

it("dispatches the next turn", async () => {
  const target = await started();
  await target.owner.next(launchOf({ turnId: IDS.nextTurn }));
  expect(h.write).toHaveBeenCalledWith(
    `/owner/turn-${IDS.nextTurn}.json`,
    expect.anything(),
  );
  expect(h.write).toHaveBeenCalledWith(
    "/owner/current.json",
    expect.anything(),
  );
  expect(target.session.next).toHaveBeenCalledOnce();
  expect(appended(target, "position")).toHaveLength(2);
});

it("ignores a repeated request and rejects a changed one", async () => {
  const target = await started();
  const next = launchOf({ turnId: IDS.nextTurn });
  h.read.mockResolvedValue(next);
  await target.owner.next(next);
  expect(target.session.next).not.toHaveBeenCalled();
  await expect(
    target.owner.next(launchOf({ turnId: IDS.nextTurn, prompt: "other" })),
  ).rejects.toThrow("request changed");
});

it("rejects foreign instances and runs", async () => {
  const target = await started();
  await expect(
    target.owner.next(launchOf({ instanceId: IDS.user })),
  ).rejects.toThrow("Foreign native turn");
  await expect(
    target.owner.next(launchOf({ runId: IDS.user })),
  ).rejects.toThrow("Foreign native turn");
});

it("rethrows an unreadable record", async () => {
  const target = await started();
  h.read.mockRejectedValue(new Error("unreadable"));
  await expect(target.owner.next(launchOf())).rejects.toThrow("unreadable");
  h.read.mockRejectedValue(
    Object.assign(new Error("denied"), { code: "EACCES" }),
  );
  await expect(target.owner.next(launchOf())).rejects.toThrow("denied");
  h.read.mockRejectedValue("plain");
  await expect(target.owner.next(launchOf())).rejects.toBe("plain");
});

it("refuses a session that cannot continue", async () => {
  const fresh = rig();
  await expect(fresh.owner.next(launchOf())).rejects.toThrow("cannot continue");
  const plain = rig();
  await plain.owner.start();
  await expect(plain.owner.next(launchOf())).rejects.toThrow("cannot continue");
  const pending = rig(launchOf(), { next: vi.fn(async () => turnOf()) });
  await pending.owner.start();
  await expect(pending.owner.next(launchOf())).rejects.toThrow(
    "cannot continue",
  );
  const done = await started();
  const closing = done.owner.close();
  await expect(done.owner.next(launchOf())).rejects.toThrow("cannot continue");
  await closing;
});

it("refuses a turn of a run that may no longer continue", async () => {
  const target = await started();
  h.canContinue.mockReturnValue(false);
  await expect(target.owner.next(launchOf())).rejects.toBeInstanceOf(
    AgentPlanCancelledError,
  );
});
