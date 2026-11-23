import { EventEmitter } from "node:events";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

import { CliProcessRunner } from "./CliProcessRunner";

import type { ChildProcess } from "node:child_process";
import type {
  CliGroupSignal,
  CliProcessResult,
  CliRunRequest,
  CliSessionRequest,
  CliSpawn,
} from "./CliContracts";

interface Deferred {
  readonly promise: Promise<CliProcessResult>;
  readonly resolve: (result: CliProcessResult) => void;
}

interface FakeProcess {
  readonly processId: number | null;
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly pending: Deferred;
}

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
  created: [] as unknown[],
  deferred: (): Deferred => {
    let resolve: (result: CliProcessResult) => void = () => undefined;
    const promise = new Promise<CliProcessResult>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  },
  failure: { current: null as Error | null },
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logEvent: mocks.logEvent,
}));

vi.mock("@/definition/AcpResource", () => ({ MAX_ACP_SESSIONS: 1 }));

vi.mock("./CliEnvironment", () => ({
  createCliRequestEnvironment: () => ({ SYNTHETIC: "1" }),
}));

vi.mock("./CliChildProcess", () => ({
  CliChildProcess: class {
    public readonly processId: number | null = 11;
    public readonly cancel = vi.fn();
    public readonly pending = mocks.deferred();
    public readonly completed = this.pending.promise;

    public constructor() {
      if (mocks.failure.current) throw mocks.failure.current;
      mocks.created.push(this);
    }
  },
}));

vi.mock("./CliSessionProcess", () => ({
  CliSessionProcess: class {
    public readonly processId: number | null = 22;
    public readonly cancel = vi.fn();
    public readonly pending = mocks.deferred();
    public readonly completed = this.pending.promise;

    public constructor() {
      if (mocks.failure.current) throw mocks.failure.current;
      mocks.created.push(this);
    }
  },
}));

const home = { root: "/r", home: "/r/h", config: "/r/c", work: "/r/w" };
const done: CliProcessResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  errorCode: null,
};

function checkRequest(overrides: Partial<CliRunRequest> = {}): CliRunRequest {
  return {
    file: "/synthetic/bin/tool",
    arguments: ["--flag"],
    provider: "codex_cli",
    home,
    timeoutMs: 1000,
    stdin: "pipe",
    ...overrides,
  };
}

function sessionRequest(
  overrides: Partial<CliSessionRequest> = {},
): CliSessionRequest {
  return {
    file: "/synthetic/bin/tool",
    arguments: [],
    provider: "codex_cli",
    home,
    workingDirectory: "/r/w",
    environment: {},
    timeoutMs: 1000,
    signal: new AbortController().signal,
    onLine: () => undefined,
    ...overrides,
  };
}

function lastCreated(): FakeProcess {
  return mocks.created.at(-1) as FakeProcess;
}

const fakeChild: ChildProcess = new EventEmitter() as ChildProcess;

function runnerWith(spawn: CliSpawn = vi.fn(() => fakeChild)): {
  runner: CliProcessRunner;
  spawn: CliSpawn;
} {
  const signalGroup: CliGroupSignal = vi.fn();
  return { runner: new CliProcessRunner({ spawn, signalGroup }), spawn };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mocks.created.length = 0;
  mocks.failure.current = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("spawns a check without a shell and logs its completion", async () => {
  const { runner, spawn } = runnerWith();
  const running = runner.start(checkRequest({ workingDirectory: "/cwd" }));

  expect(spawn).toHaveBeenCalledWith(
    "/synthetic/bin/tool",
    ["--flag"],
    expect.objectContaining({ shell: false, cwd: "/cwd" }),
  );
  lastCreated().pending.resolve({
    ...done,
    exitCode: 1,
    errorCode: "check_timeout",
  });
  await running.completed;
  await flush();

  expect(mocks.logEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({ level: "warn", event: "cli.command.completed" }),
  );
});

it("defaults the working directory and logs a clean exit as info", async () => {
  const { runner, spawn } = runnerWith();
  runner.start(checkRequest());
  expect(spawn).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(Array),
    expect.objectContaining({ cwd: "/r/w" }),
  );
  lastCreated().pending.resolve(done);
  await flush();
  expect(mocks.logEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({ level: "info" }),
  );
});

it("refuses a check that is aborted before it starts", () => {
  const { runner } = runnerWith();
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    runner.start(checkRequest({ signal: controller.signal })),
  ).toThrow(expect.objectContaining({ code: "check_timeout" }));
});

it("refuses a fifth check and frees the slot after completion", async () => {
  const { runner } = runnerWith();
  for (let index = 0; index < 4; index += 1) runner.start(checkRequest());
  expect(() => runner.start(checkRequest())).toThrow(
    expect.objectContaining({ code: "login_limit_reached" }),
  );
  lastCreated().pending.resolve(done);
  await flush();
  expect(() => runner.start(checkRequest())).not.toThrow();
});

it("maps a spawn failure of a check to cli_not_executable", () => {
  const spawn = vi.fn(() => {
    throw new Error("ENOENT");
  });
  const { runner } = runnerWith(spawn);
  expect(() => runner.start(checkRequest())).toThrow(
    expect.objectContaining({ code: "cli_not_executable" }),
  );
  expect(mocks.logCaughtError).toHaveBeenCalled();
});

it("starts a session and releases it when it completes", async () => {
  const { runner, spawn } = runnerWith();
  const session = runner.startSession(sessionRequest());
  expect(spawn).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(Array),
    expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
  );
  expect(runner.hasSession(home)).toBe(true);
  expect(runner.hasSession({ ...home, root: "/other" })).toBe(false);
  lastCreated().pending.resolve(done);
  await session.completed;
  await flush();
  expect(runner.hasSession(home)).toBe(false);
});

it("does not count checks against sessions and ignores checks in hasSession", () => {
  const { runner } = runnerWith();
  runner.start(checkRequest());
  expect(runner.hasSession(home)).toBe(false);
  expect(() => runner.startSession(sessionRequest())).not.toThrow();
});

it("refuses a session beyond the ceiling and an aborted session", () => {
  const { runner } = runnerWith();
  runner.startSession(sessionRequest());
  expect(() => runner.startSession(sessionRequest())).toThrow(
    expect.objectContaining({ code: "login_limit_reached" }),
  );
  const controller = new AbortController();
  controller.abort();
  const other = runnerWith().runner;
  expect(() =>
    other.startSession(sessionRequest({ signal: controller.signal })),
  ).toThrow(expect.objectContaining({ code: "check_timeout" }));
});

it("maps a spawn failure of a session to cli_not_executable", () => {
  const spawn = vi.fn(() => {
    throw new Error("EACCES");
  });
  const { runner } = runnerWith(spawn);
  expect(() => runner.startSession(sessionRequest())).toThrow(
    expect.objectContaining({ code: "cli_not_executable" }),
  );
});

it("maps a constructor failure after spawning and restores the umask", () => {
  mocks.failure.current = new Error("wrap failed");
  const umask = vi.spyOn(process, "umask");
  const { runner } = runnerWith();
  expect(() => runner.start(checkRequest())).toThrow(AgentError);
  expect(umask).toHaveBeenCalledTimes(2);
});

it("run returns the result of a started check", async () => {
  const { runner } = runnerWith();
  const pending = runner.run(checkRequest());
  lastCreated().pending.resolve({ ...done, stdout: "ok" });
  await expect(pending).resolves.toMatchObject({ stdout: "ok" });
});

it("run turns an AgentError into a structured failure", async () => {
  const { runner } = runnerWith();
  const controller = new AbortController();
  controller.abort();
  await expect(
    runner.run(checkRequest({ signal: controller.signal })),
  ).resolves.toEqual({
    exitCode: null,
    stdout: "",
    stderr: "",
    errorCode: "check_timeout",
  });
});

it("run turns an unknown error into cli_not_executable", async () => {
  const { runner } = runnerWith();
  vi.spyOn(runner, "start").mockImplementation(() => {
    throw new Error("boom");
  });
  await expect(runner.run(checkRequest())).resolves.toMatchObject({
    errorCode: "cli_not_executable",
  });
});

it("lists tool activities of processes below a directory", () => {
  const { runner } = runnerWith();
  runner.start(
    checkRequest({
      file: "/work/dir/tool",
      environment: { PAGES_RUN_INSTANCE: "instance-1" },
    }),
  );
  runner.start(
    checkRequest({ file: "/elsewhere/tool", toolFile: "/work/dir/x" }),
  );
  runner.start(
    checkRequest({
      file: "/elsewhere/tool",
      environment: { CODEX_PATH: "/work/dir/codex" },
    }),
  );
  runner.start(
    checkRequest({
      file: "/elsewhere/tool",
      environment: { CLAUDE_CODE_EXECUTABLE: "/work/dir/claude" },
    }),
  );
  runner.startSession(sessionRequest({ file: "/elsewhere/tool" }));

  expect(runner.toolActivities("/work/dir")).toEqual([
    { instanceId: "instance-1", processId: 11, sessionId: null },
    { instanceId: "local-operation", processId: 11, sessionId: null },
    { instanceId: "local-operation", processId: 11, sessionId: null },
    { instanceId: "local-operation", processId: 11, sessionId: null },
  ]);
});

it("reports a null process id of a running process", () => {
  const { runner } = runnerWith();
  runner.start(checkRequest({ file: "/work/dir/tool" }));
  (lastCreated() as { processId: number | null }).processId = null;
  expect(runner.toolActivities("/work/dir")[0]?.processId).toBeNull();
});

it("shutdown cancels everything, waits and refuses later starts", async () => {
  const { runner } = runnerWith();
  runner.start(checkRequest());
  const check = lastCreated();
  runner.startSession(sessionRequest());
  const session = lastCreated();
  const closing = runner.shutdown();
  expect(check.cancel).toHaveBeenCalledWith("login_cancelled");
  expect(session.cancel).toHaveBeenCalledWith("login_cancelled");
  check.pending.resolve(done);
  session.pending.resolve(done);
  await closing;
  expect(() => runner.start(checkRequest())).toThrow(
    expect.objectContaining({ code: "login_limit_reached" }),
  );
  expect(() => runner.startSession(sessionRequest())).toThrow(
    expect.objectContaining({ code: "login_limit_reached" }),
  );
});

it("uses the real spawn and process.kill when no dependencies are given", () => {
  expect(() => new CliProcessRunner()).not.toThrow();
});
