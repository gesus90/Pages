import { EventEmitter } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, vi } from "vitest";

export interface FakeChild extends EventEmitter {
  pid: number | undefined;
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: () => void };
  unref: ReturnType<typeof vi.fn>;
}

export interface RunnerJob {
  jobId: string;
  sessionId: string;
  status?: string;
  launch?: unknown;
  historyCursor?: number;
  outputJournalVersion?: number;
  liveHistoryVersion?: number;
  plan: { attemptId: string; planRevision?: number };
  execution: {
    version: number;
    program?: { kind: string; route?: { tool: string } };
  };
}

export interface ExecutionModule {
  claimJob(directory: string, job: RunnerJob): Promise<void>;
  observeJob(directory: string, job: RunnerJob): Promise<Observation | null>;
  cancelQueuedJob(directory: string, job: RunnerJob): Promise<void>;
  refuseQueuedJob(
    directory: string,
    job: RunnerJob,
    failureCode?: string,
  ): Promise<void>;
  canIsolateJobs(): Promise<boolean>;
}

export interface Observation {
  launch: unknown;
  status: string;
  result: Record<string, unknown>;
  history?: { sequence: number }[];
  historyLength?: number;
  historyFailure?: string;
  cancellation?: unknown;
}

export const mocks = {
  spawn: vi.fn(),
  identity: vi.fn<(pid: number) => Promise<string | null>>(),
  cancellationFor: vi.fn(),
  hasExecutionLease: vi.fn(),
  cancelJob: vi.fn(),
  accountTasks: vi.fn(),
  cleanup: vi.fn(),
  rememberOwnership: vi.fn(),
  antigravityContextProof: vi.fn(),
  readJournalEvents: vi.fn(),
  outputBinding: vi.fn(),
};

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../../../../../scripts/runner/journal.mjs", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  identity: mocks.identity,
}));
vi.mock("../../../../../scripts/runner/revocation.mjs", () => ({
  cancellationFor: mocks.cancellationFor,
  hasExecutionLease: mocks.hasExecutionLease,
  cancelJob: mocks.cancelJob,
}));
vi.mock("../../../../../scripts/runner/processes.mjs", () => ({
  accountTasks: mocks.accountTasks,
  cleanup: mocks.cleanup,
  rememberOwnership: mocks.rememberOwnership,
}));
vi.mock("../../../../../scripts/runner/antigravity.mjs", () => ({
  antigravityContextProof: mocks.antigravityContextProof,
}));
vi.mock("../../../../../scripts/runner/chunks.mjs", () => ({
  readJournalEvents: mocks.readJournalEvents,
}));
vi.mock("../../../../../scripts/runner/output.mjs", () => ({
  JobOutput: class {},
  outputBinding: mocks.outputBinding,
}));
vi.mock("../../../../../scripts/runner/cli.mjs", () => ({ spawnCli: vi.fn() }));
vi.mock("../../../../../scripts/runner/pages.mjs", () => ({
  preparePagesFiles: vi.fn(),
  modelAssetContent: vi.fn(),
  pagesRequest: vi.fn(),
  pagesFailure: vi.fn(),
  notifyJobCompletion: vi.fn(),
}));
vi.mock("../../../../../scripts/runner/interpreters.mjs", () => ({
  interpreters: vi.fn(),
  interpreterCatalog: vi.fn(),
}));

export const JOB_ID = "11111111-2222-3333-4444-555555555555";

export const state = {
  directory: "",
  folder: "",
  children: [] as FakeChild[],
};
let savedEnvironment: NodeJS.ProcessEnv = {};

/** Loads a fresh copy of the runner execution module with every collaborator mocked. */
export async function loadExecution(): Promise<ExecutionModule> {
  vi.resetModules();
  return (await import("../../../../../scripts/runner/execution.mjs")) as unknown as ExecutionModule;
}

/** Builds a queued dispatch for the synthetic job id. */
export function makeJob(overrides: Partial<RunnerJob> = {}): RunnerJob {
  return {
    jobId: JOB_ID,
    sessionId: "session-1",
    status: "queued",
    plan: { attemptId: "attempt-1" },
    execution: { version: 1, program: { kind: "script" } },
    ...overrides,
  };
}

/** Creates a fake child process and remembers it for later assertions. */
export function makeChild(pid: number | undefined): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdin = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    destroy: vi.fn(),
  });
  child.unref = vi.fn();
  state.children.push(child);
  return child;
}

/** Reads a JSON record the code under test stored. */
export async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

/** Seeds a JSON record, creating its folder. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

/** Makes the job folder older than the grace period of a fresh claim. */
export async function ageFolder(): Promise<void> {
  const old = new Date(Date.now() - 60_000);
  await utimes(state.folder, old, old);
}

/** Prepares a private runner directory and fresh mocks for each test. */
export function installClaimHooks(): void {
  beforeEach(async () => {
    savedEnvironment = { ...process.env };
    state.directory = await mkdtemp(
      path.join(os.tmpdir(), "pages-runner-claim-"),
    );
    state.folder = path.join(state.directory, "jobs", JOB_ID);
    state.children = [];
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.spawn.mockImplementation(() => makeChild(4242));
    mocks.identity.mockResolvedValue("boot:99");
    mocks.cancellationFor.mockResolvedValue(null);
    mocks.accountTasks.mockResolvedValue(77);
    mocks.cleanup.mockResolvedValue("confirmed");
    mocks.antigravityContextProof.mockResolvedValue('["proof"]');
    mocks.outputBinding.mockReturnValue({ bound: true });
  });

  afterEach(async () => {
    process.env = savedEnvironment;
    await rm(state.directory, { recursive: true, force: true });
  });
}
