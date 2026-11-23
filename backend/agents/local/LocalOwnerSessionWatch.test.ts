import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ok } from "node:assert";

import { LocalOwnerSession } from "@/backend/agents/local/LocalOwnerSession";
import { localDeferred } from "@/backend/agents/local/LocalDeferred";

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
const NAMESPACE = { pid: 1, uid: 2, start: 3, boot: "boot" };

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

function announce(target: Rig, namespace?: typeof NAMESPACE): void {
  observerOf(target).started({
    mode: "interactive",
    processId: null,
    startedAt: "t",
    arguments: [],
    unattended: "none",
    namespace,
  });
}

function missing(): Error {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function observerOf(target: Rig): PlanSessionObserver {
  const { observer } = target.state;
  ok(observer);
  return observer;
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

it("lets a started observation check the run once at a time", async () => {
  const target = rig();
  await target.owner.start();
  const release = localDeferred<{ status: string }>();
  target.find.mockReset();
  target.find.mockReturnValue(release.promise);
  await vi.advanceTimersByTimeAsync(750);
  expect(target.find).toHaveBeenCalledTimes(1);
  release.resolve({ status: "running" });
  await settle();
});

it("does not check once the owner is closing", async () => {
  const target = rig();
  await target.owner.start();
  void target.owner.close();
  target.find.mockClear();
  announce(target);
  await settle();
  expect(target.find).not.toHaveBeenCalled();
});

it("aborts and closes when the turn deadline expires", async () => {
  const target = rig(launchOf({ timeoutMinutes: 1 }));
  await target.owner.start();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(target.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_250);
  expect(target.close).toHaveBeenCalled();
});

it("does not count paused time or time after the turn", async () => {
  const paused = rig(launchOf({ timeoutMinutes: 1 }), {
    setPaused: vi.fn(async () => undefined),
  });
  await paused.owner.start();
  await paused.owner.setPaused(true);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(paused.close).not.toHaveBeenCalled();
  const idle = rig(launchOf({ timeoutMinutes: 1 }));
  await idle.owner.start();
  idle.turn.resolve(turnOf());
  await settle();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(idle.close).not.toHaveBeenCalled();
});

it("stops the native session when the run no longer allows it", async () => {
  const target = rig();
  await target.owner.start();
  h.canContinue.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(250);
  expect(h.controlNamespace).not.toHaveBeenCalled();
  expect(target.close).toHaveBeenCalled();
  h.canContinue.mockReturnValue(true);
  const owned = rig();
  await owned.owner.start();
  h.canContinue.mockReturnValue(false);
  announce(owned, NAMESPACE);
  await settle();
  expect(h.controlNamespace).toHaveBeenCalledWith(NAMESPACE, "stop");
});

it("follows the run's pause for a Codex session", async () => {
  const setPaused = vi.fn(async () => undefined);
  const target = rig(launchOf(), { setPaused }, "codex_cli");
  await target.owner.start();
  await vi.advanceTimersByTimeAsync(250);
  expect(setPaused).not.toHaveBeenCalled();
  target.find.mockResolvedValue({ status: "pausing" });
  await vi.advanceTimersByTimeAsync(250);
  expect(setPaused).not.toHaveBeenCalled();
  target.find.mockResolvedValue({ status: "paused" });
  await vi.advanceTimersByTimeAsync(250);
  expect(setPaused).toHaveBeenCalledWith(true);
  target.find.mockResolvedValue(null);
  await vi.advanceTimersByTimeAsync(250);
  expect(setPaused).toHaveBeenCalledWith(false);
});

it("logs a pause the session cannot perform", async () => {
  const target = rig(launchOf(), {}, "codex_cli");
  await target.owner.start();
  target.find.mockResolvedValue({ status: "paused" });
  await vi.advanceTimersByTimeAsync(250);
  expect(h.logCaught).toHaveBeenCalledWith(
    "LocalOwnerSession",
    expect.objectContaining({ message: "Session pause unavailable" }),
  );
});

it("pauses and resumes the namespace of other providers", async () => {
  const target = rig();
  await target.owner.start();
  target.find.mockResolvedValue({ status: "paused" });
  await vi.advanceTimersByTimeAsync(250);
  expect(h.controlNamespace).not.toHaveBeenCalled();
  announce(target, NAMESPACE);
  await settle();
  expect(h.controlNamespace).toHaveBeenCalledWith(NAMESPACE, "pause");
  h.controlNamespace.mockClear();
  await vi.advanceTimersByTimeAsync(250);
  expect(h.controlNamespace).not.toHaveBeenCalled();
  target.find.mockResolvedValue({ status: "running" });
  await vi.advanceTimersByTimeAsync(250);
  expect(h.controlNamespace).toHaveBeenCalledWith(NAMESPACE, "resume");
  target.find.mockResolvedValue({ status: "pausing" });
  await vi.advanceTimersByTimeAsync(250);
  expect(h.controlNamespace).toHaveBeenCalledWith(NAMESPACE, "pause");
  target.find.mockResolvedValue(null);
  await vi.advanceTimersByTimeAsync(250);
  expect(h.controlNamespace).toHaveBeenLastCalledWith(NAMESPACE, "resume");
});

it("survives a lost database without fabricating a Stop", async () => {
  const target = rig();
  await target.owner.start();
  target.find.mockRejectedValue(new Error("database lost"));
  await vi.advanceTimersByTimeAsync(250);
  expect(h.logCaught).toHaveBeenCalledWith(
    "LocalOwnerSession",
    expect.objectContaining({ message: "database lost" }),
  );
  expect(target.close).not.toHaveBeenCalled();
});
