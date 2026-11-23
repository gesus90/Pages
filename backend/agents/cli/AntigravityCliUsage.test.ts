import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AntigravityCli } from "@/backend/agents/cli/AntigravityCli";
import { AgentError } from "@/backend/error/AgentErrors";

import type {
  CliHome,
  CliProcessResult,
} from "@/backend/agents/cli/CliContracts";
import type { CliToolExecution } from "@/backend/agents/cli/CliToolExecution";
import type { Stats } from "node:fs";

const mocks = vi.hoisted(() => ({
  lstat: vi.fn(),
  logEvent: vi.fn(),
  requireConfiguration: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ lstat: mocks.lstat }));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: mocks.logEvent,
  logCaughtError: vi.fn(),
}));
vi.mock("@/backend/agents/acp/AntigravityConfiguration", () => ({
  requireManagedAntigravityConfiguration: mocks.requireConfiguration,
}));
vi.mock("@/backend/agents/cli/AntigravityProtocol", () => ({
  AntigravityProtocol: { open: vi.fn() },
  antigravityFailure: (error: unknown): string =>
    error instanceof AgentError ? error.code : "antigravity_acp_session_failed",
}));

const HOME: CliHome = {
  root: "/ctx",
  home: "/ctx/home",
  config: "/ctx/gemini",
  work: "/ctx/work",
};
const SIGNAL = new AbortController().signal;
const CHALLENGE =
  "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A41234%2F";

function tokenFile(overrides: Partial<Record<string, unknown>> = {}): Stats {
  return {
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides,
  } as unknown as Stats;
}

function cli(execution: Partial<Record<string, unknown>> = {}): AntigravityCli {
  return new AntigravityCli(execution as unknown as CliToolExecution);
}

beforeEach(() => {
  mocks.lstat.mockResolvedValue(tokenFile());
  mocks.requireConfiguration.mockResolvedValue(undefined);
});

afterEach(() => {
  mocks.lstat.mockReset();
  mocks.requireConfiguration.mockReset();
});

const usageOutput = JSON.stringify({
  status: "SUCCESS",
  num_turns: 0,
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini",
          buckets: [
            { window: "5h", remaining_fraction: 0.5, reset_time: null },
          ],
        },
      ],
    },
  },
});

function printed(
  result: Partial<CliProcessResult>,
  onStart?: (request: {
    onOutput: (stdout: string, stderr: string) => void;
  }) => void,
): ReturnType<typeof vi.fn> {
  return vi.fn((home: CliHome, request: never) => {
    onStart?.(request);
    return {
      completed: Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        ...result,
      }),
      cancel: vi.fn(),
      write: vi.fn(),
    };
  });
}

function failureLogged(stage: string, code: string): void {
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "antigravity.usage.failed",
      metadata: { provider: "antigravity", stage, code },
    }),
  );
}

it("reads the groups of the quota command", async () => {
  const printAntigravity = printed({ stdout: usageOutput });

  await expect(
    cli({ printAntigravity }).readUsage(HOME, SIGNAL),
  ).resolves.toEqual([
    {
      name: "Gemini",
      windows: [{ kind: "five_hour", remainingFraction: 0.5, resetsAt: null }],
    },
  ]);
  expect(printAntigravity.mock.calls[0][1]).toMatchObject({
    arguments: ["--print", "/usage", "--output-format", "json"],
    timeoutMs: 25_000,
  });
});

it("reports a missing sign-in without logging a fault", async () => {
  mocks.lstat.mockRejectedValue(new Error("ENOENT"));

  await expect(cli().readUsage(HOME, SIGNAL)).rejects.toMatchObject({
    code: "cli_not_logged_in",
  });
  expect(mocks.logEvent).not.toHaveBeenCalled();
});

it("logs an unusable configuration", async () => {
  mocks.requireConfiguration.mockRejectedValue(
    new AgentError("antigravity_configuration_unmanaged"),
  );

  await expect(cli().readUsage(HOME, SIGNAL)).rejects.toMatchObject({
    code: "antigravity_configuration_unmanaged",
  });
  failureLogged("configuration", "antigravity_configuration_unmanaged");
});

it("logs the failure of the process", async () => {
  const printAntigravity = printed({ errorCode: "check_timeout" });

  await expect(
    cli({ printAntigravity }).readUsage(HOME, SIGNAL),
  ).rejects.toMatchObject({ code: "check_timeout" });
  failureLogged("command", "check_timeout");
});

it("logs an answer that holds no usage", async () => {
  const printAntigravity = printed({
    stdout: JSON.stringify({
      status: "SUCCESS",
      num_turns: 0,
      command: { name: "usage", data: { other: true } },
    }),
  });

  await expect(
    cli({ printAntigravity }).readUsage(HOME, SIGNAL),
  ).rejects.toMatchObject({ code: "cli_unexpected_output" });
  failureLogged("answer", "cli_unexpected_output");
});

it.each([
  ["a failed exit", { exitCode: 1, stdout: usageOutput }],
  [
    "a status that is no success",
    { stdout: '{"status":"ERROR","num_turns":0}' },
  ],
  [
    "another command",
    {
      stdout: '{"status":"SUCCESS","num_turns":0,"command":{"name":"help"}}',
    },
  ],
  [
    "a model turn",
    {
      stdout: '{"status":"SUCCESS","num_turns":1,"command":{"name":"usage"}}',
    },
  ],
  ["plain output", { stdout: "nothing useful", exitCode: null }],
])("refuses %s as unexpected", async (label, result) => {
  await expect(
    cli({ printAntigravity: printed(result) }).readUsage(HOME, SIGNAL),
  ).rejects.toMatchObject({ code: "cli_unexpected_output" });
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ event: "antigravity.usage.unexpected_answer" }),
  );
});

it.each([
  ["a sign-in challenge", { stdout: CHALLENGE }],
  ["an authentication notice", { stderr: "Authentication required" }],
])("reports %s in the answer as a missing sign-in", async (label, result) => {
  await expect(
    cli({ printAntigravity: printed(result) }).readUsage(HOME, SIGNAL),
  ).rejects.toMatchObject({ code: "cli_not_logged_in" });
});

it("ends the command at once when it asks for a sign-in", async () => {
  const cancel = vi.fn();
  const printAntigravity = vi.fn(
    (
      home: CliHome,
      request: { onOutput: (stdout: string, stderr: string) => void },
    ) => {
      // The handle is not assigned yet, so a first notice cancels nothing.
      request.onOutput(CHALLENGE, "");
      queueMicrotask(() => {
        request.onOutput("fine", "");
        request.onOutput("", "not logged into Antigravity");
      });
      return {
        completed: new Promise((resolve) => {
          setImmediate(() =>
            resolve({
              exitCode: 1,
              stdout: "",
              stderr: "",
              errorCode: "cli_not_logged_in",
            }),
          );
        }),
        cancel,
        write: vi.fn(),
      };
    },
  );

  await expect(
    cli({ printAntigravity }).readUsage(HOME, SIGNAL),
  ).rejects.toMatchObject({ code: "cli_not_logged_in" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledWith("cli_not_logged_in");
});
