import path from "node:path";

import { vi } from "vitest";

import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";
import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type {
  LocalOwnerManifest,
  LocalOwnerProof,
  LocalSessionCommand,
  LocalSessionLaunch,
} from "@/backend/agents/local/LocalSessionContracts";

export const RUN_ID = "11111111-1111-4111-8111-111111111111";
export const STEP_ID = "step-one";
export const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
export const INSTANCE_ID = "33333333-3333-4333-8333-333333333333";
export const OTHER_INSTANCE_ID = "44444444-4444-4444-8444-444444444444";
export const USER_ID = "55555555-5555-4555-8555-555555555555";
export const PLAN_ID = "66666666-6666-4666-8666-666666666666";
export const DATA_DIRECTORY = "/data/pages";
export const CONFIG_PATH = "/etc/pages/config.json";

/** Narrows a deliberately partial test double to the type the code under test reads. */
export function stub<T>(value: unknown): T {
  return value as T;
}

/** Every collaborator of LocalSessions that crosses a database, file, socket or service boundary. */
export const mocks = {
  owners: {
    list: vi.fn(),
    create: vi.fn(),
    prove: vi.fn(),
    claim: vi.fn<(instanceId: string, token: string) => Promise<void>>(),
    released: vi.fn(),
    result: vi.fn(),
  },
  runs: { find: vi.fn() },
  files: { read: vi.fn() },
  ownership: { proveLocalOwner: vi.fn(), localManifestDigest: vi.fn() },
  records: {
    readLocalRecord: vi.fn<(file: string) => Promise<unknown>>(),
    requireLocalDirectory: vi.fn(),
    writeLocalRecord: vi.fn(),
  },
  transport: {
    sendLocalCommand:
      vi.fn<
        (
          manifest: LocalOwnerManifest,
          command: LocalSessionCommand,
          token?: string,
        ) => Promise<unknown>
      >(),
  },
  unit: {
    startLocalSessionUnit:
      vi.fn<(manifest: LocalOwnerManifest) => Promise<void>>(),
  },
  tools: { pinLocalSessionTools: vi.fn() },
  logger: { logCaughtError: vi.fn(), logEvent: vi.fn() },
  watch:
    vi.fn<
      (
        directory: string,
        options: { readonly signal: AbortSignal },
      ) => AsyncIterable<{ readonly filename: string | null }>
    >(),
  attachedArguments: [] as unknown[][],
  importArguments: [] as unknown[][],
  journalArguments: [] as unknown[][],
};

export const supervisor = {
  reserve: vi.fn(),
  identify: vi.fn(),
  release: vi.fn(),
};

export const resources = {
  open: vi.fn<
    (
      owner: unknown,
      signal: AbortSignal,
      start: (admitted: AbortSignal, lifecycle: unknown) => Promise<unknown>,
      observer: PlanSessionObserver,
    ) => Promise<PlanSession>
  >(),
  adoptSession: vi.fn(),
  completeAdopted: vi.fn(),
  registerNamespace: vi.fn(),
};

/** What the next attached session answers to a native closeout. */
export const state = { closed: undefined as PlanSessionClosed | undefined };

export const lifecycle = {
  trackSpawn: vi.fn(),
  beforeSpawn: vi.fn(),
  confirmStartEnded: vi.fn(),
};

export const CLOSED: PlanSessionClosed = {
  exit: { code: 0, signal: null },
  endedAt: "2026-11-10T10:00:00.000Z",
  leftovers: 0,
  isConfirmed: true,
};

export const PROOF: LocalOwnerProof = {
  instanceKey: "key",
  instanceId: INSTANCE_ID,
  runId: RUN_ID,
  stepId: STEP_ID,
  attemptId: ATTEMPT_ID,
  unit: `pages-local-${INSTANCE_ID}.service`,
  invocationId: "a".repeat(32),
  boot: "77777777-7777-4777-8777-777777777777",
  uid: 1000,
  pid: 4242,
  start: 17,
  cgroup: "/user.slice/pages",
  arguments: ["node"],
};

export const LAUNCH: LocalSessionLaunch = {
  runId: RUN_ID,
  stepId: STEP_ID,
  sessionScopeId: STEP_ID,
  attemptId: ATTEMPT_ID,
  turnId: ATTEMPT_ID,
  isInstruction: false,
  instanceId: INSTANCE_ID,
  userId: USER_ID,
  prompt: "do the work",
  instruction: "",
  resumeSessionId: null,
  timeoutMinutes: 30,
  mcp: null,
};

export const MANIFEST: LocalOwnerManifest = {
  version: 1,
  instanceKey: "b".repeat(64),
  capability: "c".repeat(64),
  configPath: CONFIG_PATH,
  directory: `${DATA_DIRECTORY}/local-sessions/${INSTANCE_ID}`,
  unit: `pages-local-${INSTANCE_ID}.service`,
  launch: LAUNCH,
};

/** The directory the instance keeps one native owner in. */
export function directoryOf(instanceId: string): string {
  return path.join(DATA_DIRECTORY, "local-sessions", instanceId);
}

/** One persisted owner row, unreleased and unproven unless overridden. */
export function entryOf(
  overrides: Partial<LocalSessionEntry> = {},
): LocalSessionEntry {
  return {
    instanceId: INSTANCE_ID,
    instanceKey: "key",
    runId: RUN_ID,
    stepId: STEP_ID,
    attemptId: ATTEMPT_ID,
    manifestDigest: "digest",
    proof: null,
    acknowledgedSequence: 0,
    acknowledgedDigest: "",
    checkpointFile: null,
    releasedAt: null,
    ...overrides,
  };
}

/** A plan run whose first step carries a native session record. */
export function runOf(
  status: string,
  session: unknown = null,
): { planId: string; status: string; steps: unknown[]; loops: [] } {
  return {
    planId: PLAN_ID,
    status,
    steps: [{ session }],
    loops: [],
  };
}

/** The attached native session the scheduler would wrap. */
export function createRaw(): {
  attach: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  isClosed: boolean;
  isDetached: boolean;
} {
  return {
    attach: vi.fn(async () => undefined),
    observe: vi.fn(async () => undefined),
    close: vi.fn(async () => state.closed ?? CLOSED),
    detach: vi.fn(),
    isClosed: true,
    isDetached: false,
  };
}

export const rawSessions: ReturnType<typeof createRaw>[] = [];

/** A scheduler-side session as returned by `adoptSession` and `open`. */
export function createSession(
  overrides: Partial<PlanSession> = {},
): PlanSession {
  return {
    turn: Promise.resolve(stub("turn")),
    terminated: Promise.resolve(),
    isDetached: false,
    detach: vi.fn(),
    close: vi.fn(async () => CLOSED),
    ...overrides,
  };
}

/** Observer double; the code under test only forwards it. */
export function createObserver(): PlanSessionObserver {
  return { started: vi.fn(), identified: vi.fn() };
}

/** Resets every double to the quiet, healthy default of one proven owner. */
export function resetMocks(): void {
  for (const group of [
    mocks.owners,
    mocks.runs,
    mocks.files,
    mocks.ownership,
    mocks.records,
    mocks.transport,
    mocks.unit,
    mocks.tools,
    mocks.logger,
    supervisor,
    resources,
    lifecycle,
  ])
    for (const double of Object.values(group)) double.mockReset();
  mocks.watch.mockReset().mockImplementation(async function* () {});
  mocks.attachedArguments.length = 0;
  mocks.importArguments.length = 0;
  mocks.journalArguments.length = 0;
  rawSessions.length = 0;
  state.closed = undefined;
  mocks.owners.list.mockResolvedValue([]);
  mocks.owners.result.mockResolvedValue(null);
  mocks.runs.find.mockResolvedValue(runOf("running"));
  mocks.ownership.localManifestDigest.mockReturnValue("digest");
  mocks.ownership.proveLocalOwner.mockResolvedValue({
    proof: PROOF,
    manifest: MANIFEST,
  });
  mocks.records.readLocalRecord.mockImplementation(async (file: string) => {
    if (file.endsWith("proof.json")) return PROOF;
    if (file.endsWith("current.json")) return LAUNCH;
    return {};
  });
  mocks.transport.sendLocalCommand.mockResolvedValue({});
  lifecycle.beforeSpawn.mockResolvedValue(undefined);
  resources.completeAdopted.mockResolvedValue(undefined);
  resources.adoptSession.mockImplementation(async () => createSession());
}

/** Module factories for the `vi.mock` calls of the test files. */
export const factories = {
  repository: (): Record<string, unknown> => ({
    LocalSessionRepository: function LocalSessionRepository() {
      return mocks.owners;
    },
  }),
  runRepository: (): Record<string, unknown> => ({
    AgentPlanRunRepository: function AgentPlanRunRepository() {
      return mocks.runs;
    },
  }),
  payloadStore: (): Record<string, unknown> => ({
    requireAgentFiles: () => mocks.files,
  }),
  logger: (): Record<string, unknown> => mocks.logger,
  ownership: (): Record<string, unknown> => mocks.ownership,
  records: (): Record<string, unknown> => mocks.records,
  transport: (): Record<string, unknown> => mocks.transport,
  unit: (): Record<string, unknown> => mocks.unit,
  tools: (): Record<string, unknown> => mocks.tools,
  fsPromises: (): Record<string, unknown> => ({ watch: mocks.watch }),
  journal: (): Record<string, unknown> => ({
    LocalSessionJournal: function LocalSessionJournal(...input: unknown[]) {
      mocks.journalArguments.push(input);
      return { kind: "journal" };
    },
  }),
  importer: (): Record<string, unknown> => ({
    LocalSessionImport: function LocalSessionImport(...input: unknown[]) {
      mocks.importArguments.push(input);
      return { kind: "import" };
    },
  }),
  attached: (): Record<string, unknown> => ({
    LocalAttachedSession: function LocalAttachedSession(...input: unknown[]) {
      mocks.attachedArguments.push(input);
      const raw = createRaw();
      rawSessions.push(raw);
      return raw;
    },
  }),
};
