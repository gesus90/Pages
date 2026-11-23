import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliToolExecution } from "@/backend/agents/cli/CliToolExecution";

import type { Mock } from "vitest";
import type {
  CliHome,
  CliProcessResult,
} from "@/backend/agents/cli/CliContracts";
import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { CliSessionProcess } from "@/backend/agents/cli/CliSessionProcess";
import type { CliProviderId } from "@/definition/AgentConnection";

const HOME: CliHome = {
  root: "/home-root",
  home: "/home-root/home",
  config: "/home-root/config",
  work: "/home-root/work",
};
const RESULT: CliProcessResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  errorCode: null,
};

function resultOf(stdout: string, exitCode = 0): CliProcessResult {
  return { ...RESULT, stdout, exitCode };
}

function fakeRunner(): {
  readonly runner: CliProcessRunner;
  readonly run: Mock<CliProcessRunner["run"]>;
  readonly start: Mock<CliProcessRunner["start"]>;
  readonly startSession: Mock<CliProcessRunner["startSession"]>;
} {
  const run = vi.fn<CliProcessRunner["run"]>(async () => RESULT);
  const start = vi.fn<CliProcessRunner["start"]>();
  const startSession = vi.fn<CliProcessRunner["startSession"]>();
  return {
    runner: { run, start, startSession } as unknown as CliProcessRunner,
    run,
    start,
    startSession,
  };
}

function toolOf(provider: CliProviderId): {
  readonly tool: CliToolExecution;
  readonly fake: ReturnType<typeof fakeRunner>;
} {
  const fake = fakeRunner();
  return {
    tool: new CliToolExecution(fake.runner, "/bin/agy", provider),
    fake,
  };
}

function callOf<Request>(
  mock: Mock<(request: Request) => unknown>,
  index = 0,
): Request {
  const call = mock.mock.calls[index];
  if (!call) throw new Error("The call did not happen.");
  return call[0];
}

const SIGNAL = new AbortController().signal;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("opens the protocol of antigravity inside bubblewrap", () => {
  const { tool, fake } = toolOf("antigravity");
  const onLine = vi.fn();
  tool.openProtocol(HOME, { signal: SIGNAL, instanceId: "abc", onLine });

  const request = callOf(fake.startSession, 0);
  expect(request.file).toBe("/usr/bin/bwrap");
  expect(request.toolFile).toBe("/bin/agy");
  expect(request.arguments).toContain("--die-with-parent");
  expect(request.arguments).toContain("/bin/agy");
  expect(request.environment).toEqual({ PAGES_RUN_INSTANCE: "abc" });
  expect(request.workingDirectory).toBe(HOME.work);
});

it("opens the protocol of another provider directly", () => {
  const { tool, fake } = toolOf("codex_cli");
  tool.openProtocol(HOME, {
    signal: SIGNAL,
    instanceId: "abc",
    onLine: vi.fn(),
  });

  const request = callOf(fake.startSession, 0);
  expect(request.file).toBe("/bin/agy");
  expect("toolFile" in request).toBe(false);
  expect(request.arguments).not.toContain("--die-with-parent");
});

it("prints through antigravity with a private home", () => {
  const { tool, fake } = toolOf("antigravity");
  const onOutput = vi.fn();
  tool.printAntigravity(
    HOME,
    { arguments: ["--print", "hi"], onOutput, timeoutMs: 5 },
    SIGNAL,
  );

  const request = callOf(fake.start, 0);
  expect(request.file).toBe("/usr/bin/bwrap");
  expect(request.arguments.slice(-3)).toEqual(["/bin/agy", "--print", "hi"]);
  expect(request.arguments).toContain("/home-root/home/.gemini");
  expect(request.timeoutMs).toBe(5);
  expect(request.stdin).toBe("ignore");
});

it("runs with the default and an explicit timeout", async () => {
  const { tool, fake } = toolOf("codex_cli");
  await tool.run(HOME, ["a"], SIGNAL);
  await tool.run(HOME, ["b"], SIGNAL, 7);

  expect(callOf(fake.run, 0).timeoutMs).toBe(15_000);
  expect(callOf(fake.run, 1).timeoutMs).toBe(7);
  expect(callOf(fake.run, 0).stdin).toBe("ignore");
});

it("sends a prompt through stdin", async () => {
  const { tool, fake } = toolOf("codex_cli");
  await tool.prompt(HOME, { arguments: ["x"], input: "text" }, SIGNAL);
  await tool.prompt(
    HOME,
    { arguments: ["x"], input: "t", environment: { A: "1" } },
    SIGNAL,
    9,
  );

  expect(callOf(fake.run, 0)).toMatchObject({
    stdin: "pipe",
    input: "text",
    timeoutMs: 45_000,
  });
  expect(callOf(fake.run, 1)).toMatchObject({
    timeoutMs: 9,
    environment: { A: "1" },
  });
});

it("reads a catalog with and without input", async () => {
  const { tool, fake } = toolOf("codex_cli");
  await tool.readCatalog(HOME, ["a"], SIGNAL);
  await tool.readCatalog(HOME, ["a"], SIGNAL, "in");
  await tool.readCatalog(HOME, ["a"], SIGNAL, { environment: { B: "2" } });

  const plain = callOf(fake.run, 0);
  const text = callOf(fake.run, 1);
  const object = callOf(fake.run, 2);
  expect(plain.stdin).toBe("ignore");
  expect(plain.maxStdoutBytes).toBe(8 * 1024 * 1024);
  expect(text).toMatchObject({ stdin: "pipe", input: "in" });
  expect(object).toMatchObject({ stdin: "ignore", environment: { B: "2" } });
});

it("ends the exchange input after the answer and joins the lines", async () => {
  const { tool, fake } = toolOf("codex_cli");
  let finish: (result: CliProcessResult) => void = () => undefined;
  const session = {
    cancel: vi.fn(),
    endInput: vi.fn(() => {
      finish(RESULT);
    }),
    write: vi.fn(),
    completed: new Promise<CliProcessResult>((resolve) => {
      finish = resolve;
    }),
  };
  fake.startSession.mockImplementation(
    () => session as unknown as CliSessionProcess,
  );

  const promise = tool.exchange(
    HOME,
    {
      arguments: [],
      requests: ["r1", "r2"],
      environment: {},
      isAnswer: (line) => line === "done",
    },
    SIGNAL,
  );
  const onLine = callOf(fake.startSession, 0).onLine;
  await onLine("one");
  await onLine("done");

  const result = await promise;
  expect(result.stdout).toBe("one\ndone");
  expect(session.write).toHaveBeenCalledTimes(2);
  expect(session.endInput).toHaveBeenCalledTimes(1);
});

it("cancels an exchange whose output exceeds the bound", async () => {
  const { tool, fake } = toolOf("codex_cli");
  const session = {
    cancel: vi.fn(),
    endInput: vi.fn(),
    write: vi.fn(),
    completed: Promise.resolve(RESULT),
  };
  fake.startSession.mockImplementation(
    () => session as unknown as CliSessionProcess,
  );

  const promise = tool.exchange(
    HOME,
    { arguments: [], requests: [], environment: {}, isAnswer: () => false },
    SIGNAL,
  );
  await callOf(fake.startSession, 0).onLine("x".repeat(8 * 1024 * 1024 + 1));
  await promise;

  expect(session.cancel).toHaveBeenCalledWith("cli_unexpected_output");
});

it("reads the version and reports failures", async () => {
  const { tool, fake } = toolOf("codex_cli");
  fake.run
    .mockResolvedValueOnce({ ...RESULT, errorCode: "cli_unexpected_output" })
    .mockResolvedValueOnce(resultOf("tool 1.2.3-beta.1 ok"))
    .mockResolvedValueOnce(resultOf("no version"))
    .mockResolvedValueOnce(resultOf("1.2.3", 1));

  expect(await tool.version(HOME, SIGNAL)).toEqual({
    ok: false,
    errorCode: "cli_unexpected_output",
    detail: {},
  });
  expect(await tool.version(HOME, SIGNAL)).toEqual({
    ok: true,
    detail: { cliVersion: "1.2.3-beta.1" },
  });
  expect((await tool.version(HOME, SIGNAL)).ok).toBe(false);
  expect((await tool.version(HOME, SIGNAL)).ok).toBe(false);
});

function loginSetup(provider: CliProviderId): {
  readonly tool: CliToolExecution;
  readonly fake: ReturnType<typeof fakeRunner>;
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly finish: () => void;
} {
  const { tool, fake } = toolOf(provider);
  const cancel = vi.fn();
  let finish: () => void = () => undefined;
  const completed = new Promise<CliProcessResult>((resolve) => {
    finish = () => {
      resolve(RESULT);
    };
  });
  fake.start.mockReturnValue({ cancel, completed, write: vi.fn() });
  return { tool, fake, cancel, finish };
}

it("reports the first challenge once and stops the handshake timer", async () => {
  const { tool, fake, cancel, finish } = loginSetup("codex_cli");
  const onChallenge = vi.fn();
  const parse = vi.fn((output: string) =>
    output.includes("code")
      ? { verificationUrl: "https://login.example" }
      : null,
  );
  tool.startLogin(HOME, { arguments: ["login"], parse, onChallenge });
  const request = callOf(fake.start, 0);
  expect(request.timeoutMs).toBe(930_000);
  expect(request.stdin).toBe("ignore");

  request.onOutput?.("nothing", "");
  request.onOutput?.("code", "");
  request.onOutput?.("code again", "");
  expect(onChallenge).toHaveBeenCalledTimes(1);

  finish();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(cancel).not.toHaveBeenCalled();
});

it("cancels a login without a challenge after 20 seconds", () => {
  const { tool, fake, cancel } = loginSetup("claude_code");
  tool.startLogin(HOME, {
    arguments: [],
    parse: () => null,
    onChallenge: vi.fn(),
  });
  const request = callOf(fake.start, 0);
  expect(request.timeoutMs).toBe(600_000);
  expect(request.stdin).toBe("pipe");

  vi.advanceTimersByTime(20_000);
  expect(cancel).toHaveBeenCalledWith("cli_unexpected_output");
});

it("uses a piped stdin for antigravity login and ignores a late timer after a challenge", () => {
  const { tool, fake, cancel } = loginSetup("antigravity");
  tool.startLogin(HOME, {
    arguments: [],
    parse: () => ({ verificationUrl: "https://login.example" }),
    onChallenge: vi.fn(),
  });
  const request = callOf(fake.start, 0);
  expect(request.stdin).toBe("pipe");
  request.onOutput?.("a", "b");

  vi.advanceTimersByTime(20_000);
  expect(cancel).not.toHaveBeenCalled();
});
