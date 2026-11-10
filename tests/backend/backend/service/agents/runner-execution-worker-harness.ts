import { EventEmitter } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, vi } from "vitest";

export type Hook = (context: WorkerContext) => void;

export interface FakeStream extends EventEmitter {
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

export interface WorkerContext {
  child: FakeChild;
  output: FakeOutput;
}

export interface FakeChild extends EventEmitter {
  pid: number | undefined;
  stdout: FakeStream;
  stderr: FakeStream;
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
}

export interface FakeOutput extends EventEmitter {
  destroyed: boolean;
  constructorArguments: unknown[];
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  initialize: ReturnType<typeof vi.fn>;
  result: ReturnType<typeof vi.fn>;
  sessionFailure: ReturnType<typeof vi.fn>;
}

export interface StoredResult {
  status: string;
  result: Record<string, unknown>;
}

export const mocks = {
  spawn: vi.fn(),
  spawnCli: vi.fn(),
  interpreters: vi.fn(),
  identity: vi.fn(),
  cancellationFor: vi.fn(),
  hasExecutionLease: vi.fn(),
  cleanup: vi.fn(),
  preparePagesFiles: vi.fn(),
  modelAssetContent: vi.fn(),
  pagesRequest: vi.fn(),
  pagesFailure: vi.fn(),
  notifyJobCompletion: vi.fn(),
  outputs: [] as unknown[],
  outputResult: { current: undefined as unknown },
};

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../../../../../scripts/runner/cli.mjs", () => ({
  spawnCli: mocks.spawnCli,
}));
vi.mock("../../../../../scripts/runner/interpreters.mjs", () => ({
  interpreters: mocks.interpreters,
  interpreterCatalog: vi.fn(),
}));
vi.mock("../../../../../scripts/runner/journal.mjs", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  identity: mocks.identity,
}));
vi.mock("../../../../../scripts/runner/revocation.mjs", () => ({
  cancellationFor: mocks.cancellationFor,
  hasExecutionLease: mocks.hasExecutionLease,
  cancelJob: vi.fn(),
}));
vi.mock("../../../../../scripts/runner/processes.mjs", () => ({
  accountTasks: vi.fn(),
  cleanup: mocks.cleanup,
  rememberOwnership: vi.fn(),
}));
vi.mock("../../../../../scripts/runner/antigravity.mjs", () => ({
  antigravityContextProof: vi.fn(),
}));
vi.mock("../../../../../scripts/runner/chunks.mjs", () => ({
  readJournalEvents: vi.fn(),
}));
vi.mock("../../../../../scripts/runner/pages.mjs", () => ({
  preparePagesFiles: mocks.preparePagesFiles,
  modelAssetContent: mocks.modelAssetContent,
  pagesRequest: mocks.pagesRequest,
  pagesFailure: mocks.pagesFailure,
  notifyJobCompletion: mocks.notifyJobCompletion,
}));
vi.mock("../../../../../scripts/runner/output.mjs", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class JobOutput extends Emitter {
    public destroyed = false;
    public constructorArguments: unknown[];
    public initialize = vi.fn(async () => undefined);
    public write = vi.fn(() => true);
    public end = vi.fn(() => queueMicrotask(() => this.emit("finish")));
    public close = vi.fn(async () => undefined);
    public result = vi.fn(() => mocks.outputResult.current);
    public sessionFailure = vi.fn(() => undefined);

    public constructor(...constructorArguments: unknown[]) {
      super();
      this.constructorArguments = constructorArguments;
      mocks.outputs.push(this);
    }
  }
  return {
    JobOutput,
    outputBinding: (job: { jobId: string }, launch: { id: string }) => ({
      jobId: job.jobId,
      launchId: launch.id,
    }),
  };
});

export const JOB_ID = "11111111-2222-3333-4444-555555555555";
export const SCRIPT_PATH = path.resolve(
  __dirname,
  "../../../../../scripts/runner/execution.mjs",
);

export const state = {
  privateRoot: "",
  folder: "",
  workspace: "",
  children: [] as FakeChild[],
};
let savedEnvironment: NodeJS.ProcessEnv = {};
let savedArguments: string[] = [];
let savedStdin: PropertyDescriptor | undefined;

/** Creates a fake output pipe of a child process. */
export function makeStream(): FakeStream {
  return Object.assign(new EventEmitter(), {
    pause: vi.fn(),
    resume: vi.fn(),
    destroy: vi.fn(),
  });
}

/** Creates a fake child process and remembers it for later assertions. */
export function makeChild(pid: number | undefined): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = makeStream();
  child.stderr = makeStream();
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  state.children.push(child);
  return child;
}

/** Builds the execution of a Node script job with valid bounds. */
export function scriptCommand(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    revision: 3,
    timeoutSeconds: 5,
    outputBytes: 1000,
    input: "input-bytes",
    workspace: state.workspace,
    program: {
      kind: "script",
      source: "console.log(1)",
      interpreter: { id: "node", path: "/usr/bin/node", digest: "digest-1" },
    },
    ...overrides,
  };
}

export interface Scenario {
  command?: Record<string, unknown>;
  release?: string;
  launch?: unknown;
  files?: Record<string, unknown>;
  /** Runs while the child reads its input; the child is still running. */
  onInput?: Hook;
  /** Exit of the child after its input was written; `null` keeps it running until cleanup. */
  exit?: [number | null, string | null] | null;
  /** The child closes as soon as cleanup stops it. */
  closeOnStop?: boolean;
  /** Process id of the child; `null` models a spawn that yielded none. */
  pid?: number | null;
  /** The start of a CLI job fails with this error. */
  startError?: Error;
}

/** Seeds a JSON record, creating its folder. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

/** Imports the worker entry point with the files of a scenario in place. */
export async function runWorker(scenario: Scenario = {}): Promise<void> {
  const command = scenario.command ?? scriptCommand();
  await writeJson(path.join(state.folder, "claim.json"), {
    jobId: JOB_ID,
    sessionId: "session-1",
    plan: { attemptId: "attempt-1", planRevision: 3 },
    execution: command,
  });
  if (scenario.launch !== null)
    await writeJson(
      path.join(state.folder, "launch.json"),
      scenario.launch ?? { id: "launch-1", boundary: "pid_namespace" },
    );
  for (const [name, value] of Object.entries(scenario.files ?? {}))
    await writeJson(path.join(state.privateRoot, name), value);

  const arrange = (child: FakeChild): FakeChild => {
    child.stdin.end.mockImplementation(() => {
      const output = mocks.outputs.at(-1) as FakeOutput;
      scenario.onInput?.({ child, output });
      if (scenario.exit !== null)
        setImmediate(() => {
          const [code, signal] = scenario.exit ?? [0, null];
          child.emit("close", code, signal);
        });
    });
    return child;
  };
  const pid = scenario.pid === null ? undefined : (scenario.pid ?? 5151);
  mocks.spawn.mockImplementation(() => arrange(makeChild(pid)));
  mocks.spawnCli.mockImplementation(async () => {
    if (scenario.startError) throw scenario.startError;
    return arrange(makeChild(pid));
  });
  if (scenario.closeOnStop)
    mocks.cleanup.mockImplementation(async () => {
      for (const child of state.children) child.emit("close", null, "SIGTERM");
      return "confirmed";
    });

  process.argv = [process.argv[0], "vitest", "--job", state.folder];
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: Readable.from([scenario.release ?? "go\n"]),
  });
  vi.resetModules();
  await import(SCRIPT_PATH);
}

/** Reads the terminal record the worker stored. */
export async function storedResult(): Promise<StoredResult> {
  return JSON.parse(
    await readFile(path.join(state.folder, "result.json"), "utf8"),
  ) as StoredResult;
}

/** Prepares a private runner root, workspace and fresh mocks for each test. */
export function installWorkerHooks(): void {
  beforeEach(async () => {
    savedEnvironment = { ...process.env };
    savedArguments = [...process.argv];
    savedStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    state.privateRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "pages-runner-worker-")),
    );
    state.folder = path.join(state.privateRoot, "jobs", JOB_ID);
    state.workspace = path.join(state.privateRoot, "workspace");
    await mkdir(state.folder, { recursive: true, mode: 0o755 });
    await mkdir(state.workspace);
    state.children = [];
    mocks.outputs.length = 0;
    for (const mock of Object.values(mocks))
      if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
    mocks.outputResult.current = {
      output: "script-output",
      stderr: "",
    };
    mocks.interpreters.mockResolvedValue([
      { id: "node", path: "/usr/bin/node", digest: "digest-1" },
      { id: "python", path: "/usr/bin/python3", digest: "digest-2" },
    ]);
    mocks.identity.mockResolvedValue("boot:77");
    mocks.cancellationFor.mockResolvedValue(null);
    mocks.hasExecutionLease.mockResolvedValue(true);
    mocks.cleanup.mockResolvedValue("confirmed");
    mocks.pagesFailure.mockReturnValue("plan_mcp_unavailable");
    mocks.notifyJobCompletion.mockResolvedValue(undefined);
    process.env.PAGES_RUNNER_HOST_TASKS = "77";
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env = savedEnvironment;
    process.argv = savedArguments;
    if (savedStdin) Object.defineProperty(process, "stdin", savedStdin);
    await rm(state.privateRoot, { recursive: true, force: true });
  });
}
