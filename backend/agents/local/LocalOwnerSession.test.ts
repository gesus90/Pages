import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ok } from "node:assert";

import { LocalOwnerSession } from "@/backend/agents/local/LocalOwnerSession";
import { localDeferred } from "@/backend/agents/local/LocalDeferred";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentError } from "@/backend/error/AgentErrors";
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

function missing(): Error {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function observerOf(target: Rig): PlanSessionObserver {
  const { observer } = target.state;
  ok(observer);
  return observer;
}

function recorderOf(): FakeRecorder {
  const [recorder] = h.recorders;
  ok(recorder);
  return recorder;
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

it("opens the native session once and records the finished turn", async () => {
  const target = rig();
  const first = target.owner.start();
  expect(target.owner.start()).toBe(first);
  await first;
  expect(h.write).toHaveBeenCalledWith(
    "/owner/dispatch.json",
    expect.objectContaining({ attemptId: IDS.attempt, prompt: "prompt" }),
  );
  expect(appended(target, "position")).toHaveLength(1);
  expect(target.open).toHaveBeenCalledOnce();
  expect(recorderOf().current).toMatchObject({
    state: "running",
    context: { unknown: true },
  });
  target.turn.resolve(turnOf({ events: ["secret"] }));
  await settle();
  expect(recorderOf().current.state).toBe("idle");
  expect(recorderOf().note).not.toHaveBeenCalled();
  expect(appended(target, "turn")).toMatchObject([
    { result: { output: "clean:answer", events: ["clean:secret"] } },
  ]);
  await expect(target.owner.close()).resolves.toBe(CLOSED);
  expect(recorderOf().current.state).toBe("ended");
  expect(appended(target, "closed")).toHaveLength(1);
});

it.each([
  [{ failure: "cancelled" as const }, "cancelled", "turn cancelled"],
  [{ failure: "timeout" as const }, "failed", "turn timeout"],
  [
    { errorCode: "plan_mcp_unavailable" as const },
    "failed",
    "turn failed: plan_mcp_unavailable",
  ],
])("notes the abnormal turn %j", async (result, state, note) => {
  const target = rig();
  await target.owner.start();
  target.turn.resolve(turnOf(result));
  await settle();
  expect(recorderOf().note).toHaveBeenCalledWith({
    kind: "error",
    text: note,
  });
  expect(recorderOf().current.state).toBe(state);
  await target.owner.close();
  expect(recorderOf().current.state).toBe(state);
});

it("turns a rejected native turn into a failed result", async () => {
  const target = rig();
  await target.owner.start();
  target.turn.reject(new AgentError("plan_mcp_unavailable"));
  await settle();
  expect(appended(target, "turn")).toMatchObject([
    { result: { failure: "failed", errorCode: "plan_mcp_unavailable" } },
  ]);
  const other = rig();
  h.recorders.length = 0;
  await other.owner.start();
  other.turn.reject(new Error("boom"));
  await settle();
  expect(appended(other, "turn")).toMatchObject([
    { result: { errorCode: "plan_step_failed" } },
  ]);
});

it("fails the owner when the recorder is unavailable at the end of a turn", async () => {
  const target = rig();
  await target.owner.start();
  Reflect.set(target.owner, "recorder", null);
  target.turn.resolve(turnOf());
  await settle();
  expect(h.logCaught).toHaveBeenCalledWith(
    "LocalOwnerSession",
    expect.objectContaining({ message: "Native recorder is unavailable" }),
  );
  expect(target.close).toHaveBeenCalled();
});

it("closes after the native process terminates, or fails when closing fails", async () => {
  const terminated = localDeferred<void>();
  const target = rig(launchOf(), { terminated: terminated.promise });
  await target.owner.start();
  terminated.resolve();
  await settle();
  expect(target.close).toHaveBeenCalledOnce();

  const broken = localDeferred<void>();
  const failing = rig(launchOf(), { terminated: broken.promise });
  await failing.owner.start();
  broken.reject(new Error("lost"));
  await settle();
  expect(h.logCaught).toHaveBeenCalledWith(
    "LocalOwnerSession",
    expect.any(Error),
  );
  await expect(failing.owner.close()).rejects.toThrow(
    "Native history is incomplete",
  );
});

it("reuses the shared recorder context for the same attempt", async () => {
  const target = rig(launchOf({ turnId: IDS.turn }));
  await target.owner.start();
  recorderOf().current = {
    ...recorderOf().current,
    key: { attemptId: IDS.attempt },
    context: { shared: true },
    confirmedModel: { value: "m", source: "plan", reportedAt: "t" },
    confirmedReasoning: { value: "r", source: "plan", reportedAt: "t" },
  };
  target.turn.resolve(turnOf());
  await settle();
  target.session.next = vi.fn(async () => turnOf());
  await target.owner.next(launchOf({ turnId: IDS.nextTurn }));
  expect(recorderOf().current).toMatchObject({
    context: { shared: true },
    confirmedModel: { value: "m" },
  });
});

it("journals every observation and keeps the namespace", async () => {
  const target = rig();
  await target.owner.start();
  const observer = observerOf(target);
  observer.started({
    mode: "interactive",
    processId: 1,
    startedAt: "t",
    arguments: ["a"],
    unattended: "none",
    namespace: NAMESPACE,
  });
  observer.identified("native");
  observer.capabilities?.(double({ steer: true }));
  observer.progressed?.(["event"]);
  observer.activity?.(double({ titles: ["title"] }));
  await settle();
  for (const kind of [
    "started",
    "identified",
    "capabilities",
    "progressed",
    "activity",
  ])
    expect(appended(target, kind)).toHaveLength(1);
  expect(appended(target, "progressed")).toMatchObject([
    { events: ["clean:event"] },
  ]);
  expect(appended(target, "activity")).toMatchObject([
    { activity: { titles: ["clean:title"] } },
  ]);
});

it("fails the owner when the journal refuses a mutation", async () => {
  const target = rig();
  await target.owner.start();
  target.append.mockRejectedValueOnce(new Error("disk"));
  observerOf(target).identified("native");
  await settle();
  expect(h.logCaught).toHaveBeenCalledWith(
    "LocalOwnerSession",
    expect.objectContaining({ message: "disk" }),
  );
  expect(target.close).toHaveBeenCalled();
});

it("logs a close that fails while failing the owner", async () => {
  const target = rig();
  await target.owner.start();
  await target.owner.fail(new Error("first"));
  expect(target.close).toHaveBeenCalledOnce();
  const again = rig();
  await again.owner.start();
  again.close.mockRejectedValue(new Error("close"));
  await again.owner.fail(new Error("again"));
  expect(h.logCaught).toHaveBeenCalledWith(
    "LocalOwnerSession",
    expect.objectContaining({ message: "close" }),
  );
});

it("records a failed preparation and closes", async () => {
  const target = rig(launchOf({ mcp: { url: "u", tools: null } }));
  const starting = target.owner.start();
  await vi.advanceTimersByTimeAsync(60_000);
  await starting;
  expect(recorderOf().note).toHaveBeenCalledWith({
    kind: "error",
    text: "native startup: plan_mcp_unavailable",
  });
  expect(appended(target, "turn")).toMatchObject([
    { result: { failure: "failed", errorCode: "plan_mcp_unavailable" } },
  ]);
  expect(appended(target, "closed")).toMatchObject([
    { result: { isConfirmed: true } },
  ]);
});

it("hands the bearer over to the preparation", async () => {
  const target = rig(launchOf({ mcp: { url: "u", tools: ["t"] } }));
  const starting = target.owner.start();
  target.owner.receiveBearer("token");
  await starting;
  expect(target.prepare).toHaveBeenCalledWith(expect.anything(), "token");
});

it("reports an unknown failure as a cancelled one after Stop", async () => {
  const target = rig();
  target.prepare.mockImplementation(async () => {
    void target.owner.cancel();
    throw new Error("unknown");
  });
  await target.owner.start();
  expect(appended(target, "turn")).toMatchObject([
    { result: { failure: "cancelled", errorCode: "plan_step_failed" } },
  ]);
  expect(recorderOf().note).toHaveBeenCalledWith({
    kind: "error",
    text: "native startup: plan_step_failed",
  });
});

it("reports a cancelled preparation and an unconfirmed cleanup", async () => {
  const cancelled = rig();
  cancelled.prepare.mockRejectedValue(new AgentPlanCancelledError());
  await cancelled.owner.start();
  expect(appended(cancelled, "turn")).toMatchObject([
    { result: { failure: "cancelled" } },
  ]);
  const unconfirmed = rig();
  unconfirmed.prepare.mockRejectedValue(new AcpCleanupUnconfirmedError());
  await unconfirmed.owner.start();
  expect(appended(unconfirmed, "closed")).toMatchObject([
    { result: { isConfirmed: false } },
  ]);
});

it.each([
  {
    when: "run is gone",
    arrange: () => h.allResults.mockReturnValue([]),
    message: "not bound",
  },
  {
    when: "recording is unavailable",
    arrange: () => h.sessionStart.mockReturnValue(null),
    message: "recording is unavailable",
  },
  {
    when: "step has no session",
    arrange: () =>
      h.allResults.mockReturnValue([{ id: "step", session: null }]),
    message: "not bound",
  },
])("rejects when the $when", async ({ arrange, message }) => {
  const target = rig();
  target.prepare.mockRejectedValue(new Error("prepare"));
  arrange();
  await expect(target.owner.start()).rejects.toThrow(message);
  await expect(target.owner.close()).rejects.toMatchObject({
    code: "plan_history_unavailable",
  });
});

it("rejects when the run record is missing", async () => {
  const target = rig();
  target.prepare.mockRejectedValue(new Error("prepare"));
  target.find.mockResolvedValue(null);
  await expect(target.owner.start()).rejects.toThrow("not bound");
});

it("skips results of other nodes and attempts", async () => {
  const target = rig();
  target.prepare.mockRejectedValue(new Error("prepare"));
  h.allResults.mockReturnValue([
    { id: "other", session: { attemptId: IDS.attempt } },
    { id: "step", session: { attemptId: IDS.turn } },
    { id: "step", session: { attemptId: IDS.attempt } },
  ]);
  await target.owner.start();
  expect(h.sessionStart).toHaveBeenCalled();
});

it("keeps the recorder of an earlier preparation for a later failure", async () => {
  const target = rig();
  target.session.close = vi.fn(async () => CLOSED);
  target.open.mockRejectedValue(new Error("open"));
  await target.owner.start();
  expect(h.recorders).toHaveLength(1);
  expect(appended(target, "turn")).toHaveLength(1);
});

it("closes a session whose recorder is unavailable", async () => {
  const target = rig();
  await target.owner.start();
  target.turn.resolve(turnOf());
  await settle();
  Reflect.set(target.owner, "recorder", null);
  await expect(target.owner.close()).resolves.toBe(CLOSED);
  expect(appended(target, "closed")).toHaveLength(1);
});
