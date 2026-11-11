import { vi } from "vitest";

import type { AcpSteerOutcome } from "@/backend/agents/acp/AcpChat";
import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { LocalSessionLaunch } from "@/backend/agents/local/LocalSessionContracts";

export const RUN_ID = "11111111-1111-4111-8111-111111111111";
export const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
export const INSTANCE_ID = "33333333-3333-4333-8333-333333333333";
export const PLAN_ID = "66666666-6666-4666-8666-666666666666";
export const STEP_ID = "step-one";
export const DIRECTORY = "/owner";

export const CLOSED: PlanSessionClosed = {
  exit: null,
  endedAt: "2026-11-11T00:00:00.000Z",
  leftovers: 0,
  isConfirmed: true,
};

export const GOOD_TURN: PlanSessionTurn = {
  output: "done",
  sessionId: "native-1",
  failure: null,
  errorCode: null,
  endedAt: "2026-11-11T00:00:01.000Z",
  permissionDenials: 0,
  effective: {},
  events: ["finished"],
};

/** Narrows a deliberately partial test double to the type the code under test reads. */
export function stub<T>(value: unknown): T {
  return value as T;
}

/** The recorder as the owner drives it; the real one is covered by its own tests. */
export interface FakeRecorder {
  current: Record<string, unknown>;
  readonly dependencies: { readonly store: unknown };
  readonly bind: ReturnType<typeof vi.fn>;
  readonly revise: ReturnType<typeof vi.fn>;
  readonly note: ReturnType<typeof vi.fn>;
}

/** Every collaborator of the owner that crosses a file, database or service boundary. */
export const doubles = {
  recorders: [] as unknown[],
  listeners: [] as unknown[],
  outboxes: [] as unknown[],
  read: vi.fn(),
  write: vi.fn(),
  logCaughtError: vi.fn(),
  checkSessionWorkspace: vi.fn(),
  sessionStart: vi.fn(),
  append: vi.fn<(mutation: { kind: string }) => Promise<void>>(),
  findRun: vi.fn(),
  prepare: vi.fn(),
  open: vi.fn(),
};

/** Module factories; the test files hand them to `vi.mock` through a dynamic import. */
export const factories = {
  files: (): object => ({
    readLocalRecord: doubles.read,
    writeLocalRecord: doubles.write,
  }),
  logger: (): object => ({ logCaughtError: doubles.logCaughtError }),
  workspace: (): object => ({
    checkSessionWorkspace: doubles.checkSessionWorkspace,
  }),
  attempts: (): object => ({ sessionStart: doubles.sessionStart }),
  sessionJournal: (): object => ({
    AgentSessionJournal: class {
      public readonly store: unknown;

      public constructor(store: unknown) {
        this.store = store;
      }
    },
  }),
  recorder: (): object => ({
    AgentSessionRecorder: class {
      public current: Record<string, unknown>;
      public readonly bind = vi.fn((attempt: Record<string, unknown>) => {
        this.current = attempt;
      });
      public readonly revise = vi.fn((attempt: Record<string, unknown>) => {
        this.current = attempt;
      });
      public readonly note = vi.fn();
      public readonly settled = vi.fn(async () => {});
      public readonly drained = vi.fn(async () => {});

      public readonly dependencies: { readonly store: unknown };

      public constructor(
        dependencies: { readonly store: unknown },
        attempt: Record<string, unknown>,
      ) {
        this.dependencies = dependencies;
        this.current = attempt;
        doubles.recorders.push(this);
      }
    },
  }),
  listener: (): object => ({
    LocalAcpJournalListener: class {
      public readonly drained = vi.fn(async () => {});
      public readonly recorder: unknown;
      public readonly journal: unknown;

      public constructor(recorder: unknown, journal: unknown) {
        this.recorder = recorder;
        this.journal = journal;
        doubles.listeners.push(this);
      }
    },
  }),
  outbox: (): object => ({
    LocalSessionOutbox: class {
      public readonly database: unknown;
      public readonly journal: unknown;

      public constructor(database: unknown, journal: unknown) {
        this.database = database;
        this.journal = journal;
        doubles.outboxes.push(this);
      }
    },
  }),
};

/** A launch request of the first turn, with optional overrides. */
export function launchOf(
  overrides: Partial<LocalSessionLaunch> = {},
): LocalSessionLaunch {
  return {
    runId: RUN_ID,
    stepId: STEP_ID,
    sessionScopeId: "scope",
    attemptId: ATTEMPT_ID,
    turnId: "turn-1",
    isInstruction: false,
    instanceId: INSTANCE_ID,
    userId: "user-1",
    prompt: "implement it",
    instruction: "report",
    resumeSessionId: null,
    timeoutMinutes: 30,
    mcp: null,
    ...overrides,
  };
}

/** The error a missing control file raises. */
export function missing(): Error {
  return Object.assign(new Error("no such file"), { code: "ENOENT" });
}

/** A native session double that finishes its turn at once. */
export function newSession(overrides: Partial<PlanSession> = {}): PlanSession {
  return {
    turn: Promise.resolve(GOOD_TURN),
    close: vi.fn(async () => CLOSED),
    next: vi.fn(() => Promise.resolve(GOOD_TURN)),
    steer: vi.fn(async (): Promise<AcpSteerOutcome> => "injected"),
    interrupt: vi.fn(async () => true),
    ...overrides,
  };
}

/** A turn that never ends, so the owner stays busy. */
export function endlessTurn(): Promise<PlanSessionTurn> {
  return new Promise<PlanSessionTurn>(() => {});
}

/** The nth recorder the owner created. */
export function recorderOf(index = 0): FakeRecorder {
  return stub<FakeRecorder>(doubles.recorders[index]);
}

/** The journal mutations of one kind, in order. */
export function appended(kind: string): Record<string, unknown>[] {
  return doubles.append.mock.calls
    .map(([mutation]) => stub<Record<string, unknown>>(mutation))
    .filter((mutation) => mutation.kind === kind);
}

/** The observer the owner passed to the first native open. */
export function observerOf(): PlanSessionObserver {
  return stub<PlanSessionObserver>(doubles.open.mock.calls[0]?.[2]);
}

/** Lets the scheduler settle pending promise chains under fake timers. */
export async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** A run whose step carries the session record of the launched attempt. */
export function runWithAttempt(): Record<string, unknown> {
  return {
    id: RUN_ID,
    planId: PLAN_ID,
    userId: "user-1",
    stopRequested: false,
    steps: [
      {
        id: STEP_ID,
        groupId: "group-1",
        session: {
          attemptId: ATTEMPT_ID,
          runner: "codex_cli",
          requested: { directory: "/work" },
        },
      },
    ],
    loops: [],
  };
}

/** The attempt start the stubbed derivation answers for the run above. */
export function attemptStart(): Record<string, unknown> {
  return {
    key: {
      planId: PLAN_ID,
      runId: RUN_ID,
      stepId: STEP_ID,
      attemptId: ATTEMPT_ID,
    },
    userId: "user-1",
    provider: "codex_cli",
    instanceId: INSTANCE_ID,
    groupId: "group-1",
    directory: "/work",
  };
}

/** Fresh doubles with the happy-path answers; fake timers keep the stop poll from leaking. */
export function resetDoubles(): void {
  vi.useFakeTimers();
  doubles.recorders.length = 0;
  doubles.listeners.length = 0;
  doubles.outboxes.length = 0;
  doubles.read.mockReset().mockRejectedValue(missing());
  doubles.write.mockReset().mockResolvedValue(undefined);
  doubles.logCaughtError.mockReset();
  doubles.checkSessionWorkspace
    .mockReset()
    .mockResolvedValue({ checked: "workspace" });
  doubles.sessionStart.mockReset();
  doubles.append.mockReset().mockResolvedValue(undefined);
  doubles.findRun.mockReset().mockResolvedValue({ stopRequested: false });
  doubles.prepare.mockReset().mockResolvedValue({
    recording: { key: { attemptId: ATTEMPT_ID }, provider: "codex_cli" },
    input: { directory: "/work", prompt: "implement it" },
  });
  doubles.open.mockReset().mockImplementation(async () => newSession());
}
