import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  readClaudeTest: vi.fn(),
  readClaudeModels: vi.fn(),
  readClaudeUsage: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));
vi.mock("./CliResultParser", () => ({ readClaudeTest: mocks.readClaudeTest }));
vi.mock("./CliModelCatalog", () => ({
  readClaudeModels: mocks.readClaudeModels,
}));
vi.mock("./ClaudeUsageResult", async (importOriginal) => ({
  ...(await importOriginal<typeof ClaudeUsageResultModule>()),
  readClaudeUsage: mocks.readClaudeUsage,
}));

import { ClaudeCodeCli } from "./ClaudeCodeCli";
import { CliProcessRunner } from "./CliProcessRunner";
import { CliToolExecution } from "./CliToolExecution";

import type * as ClaudeUsageResultModule from "./ClaudeUsageResult";
import type {
  CliHome,
  CliProcessResult,
  CliRunningProcess,
} from "./CliContracts";

const HOME: CliHome = {
  root: "/synthetic",
  home: "/synthetic/home",
  config: "/synthetic/claude",
  work: "/synthetic/work",
};
const SIGNAL = new AbortController().signal;

function result(overrides: Partial<CliProcessResult> = {}): CliProcessResult {
  return { exitCode: 0, stdout: "", stderr: "", errorCode: null, ...overrides };
}

function create(): { cli: ClaudeCodeCli; execution: CliToolExecution } {
  const execution = new CliToolExecution(
    new CliProcessRunner(),
    "claude",
    "claude_code",
  );
  return { cli: new ClaudeCodeCli(execution), execution };
}

beforeEach(() => {
  mocks.logCaughtError.mockReset();
});

it("reports a CLI failure code while reading the status", async () => {
  const { cli, execution } = create();
  vi.spyOn(execution, "run").mockResolvedValue(
    result({ errorCode: "check_timeout" }),
  );
  await expect(cli.readStatus(HOME, SIGNAL)).resolves.toEqual({
    outcome: { ok: false, errorCode: "check_timeout", detail: {} },
    accountLabel: null,
  });
});

it("logs and rejects status output that is not a JSON object", async () => {
  const { cli, execution } = create();
  vi.spyOn(execution, "run").mockResolvedValue(result({ stdout: "nope" }));
  await expect(cli.readStatus(HOME, SIGNAL)).resolves.toEqual({
    outcome: { ok: false, errorCode: "cli_unexpected_output", detail: {} },
    accountLabel: null,
  });
  expect(mocks.logCaughtError).toHaveBeenCalledWith(
    "ClaudeCodeCli",
    expect.anything(),
  );
});

it("accepts only a claude.ai login and labels the account by a valid email", async () => {
  const { cli, execution } = create();
  const run = vi.spyOn(execution, "run");
  const accepted = (email: unknown): string =>
    JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email });
  run.mockResolvedValueOnce(result({ stdout: accepted("a@b.invalid") }));
  await expect(cli.readStatus(HOME, SIGNAL)).resolves.toEqual({
    outcome: { ok: true, detail: { authMethod: "claude.ai" } },
    accountLabel: "a@b.invalid",
  });
  run.mockResolvedValueOnce(result({ stdout: accepted("not an email") }));
  expect((await cli.readStatus(HOME, SIGNAL)).accountLabel).toBeNull();
  run.mockResolvedValueOnce(result({ stdout: accepted(7) }));
  expect((await cli.readStatus(HOME, SIGNAL)).accountLabel).toBeNull();
});

it("rejects api key logins, other login states and failed exits", async () => {
  const { cli, execution } = create();
  const run = vi.spyOn(execution, "run");
  const rejected = {
    outcome: { ok: false, errorCode: "cli_not_logged_in", detail: {} },
    accountLabel: null,
  };
  run.mockResolvedValueOnce(
    result({ stdout: JSON.stringify({ loggedIn: true, authMethod: "key" }) }),
  );
  await expect(cli.readStatus(HOME, SIGNAL)).resolves.toEqual(rejected);
  run.mockResolvedValueOnce(
    result({ stdout: JSON.stringify({ loggedIn: false }) }),
  );
  await expect(cli.readStatus(HOME, SIGNAL)).resolves.toEqual(rejected);
  run.mockResolvedValueOnce(
    result({
      exitCode: 1,
      stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
    }),
  );
  await expect(cli.readStatus(HOME, SIGNAL)).resolves.toEqual(rejected);
});

it("delegates the version and the login start to the shared execution", () => {
  const { cli, execution } = create();
  const outcome = Promise.resolve({ ok: true as const, detail: {} });
  const version = vi.spyOn(execution, "version").mockReturnValue(outcome);
  expect(cli.version(HOME, SIGNAL)).toBe(outcome);
  expect(version).toHaveBeenCalledWith(HOME, SIGNAL);
  const running: CliRunningProcess = {
    cancel: vi.fn(),
    write: vi.fn(() => true),
    completed: Promise.resolve(result()),
  };
  const start = vi.spyOn(execution, "startLogin").mockReturnValue(running);
  const onChallenge = vi.fn();
  expect(cli.startLogin(HOME, onChallenge)).toBe(running);
  expect(start).toHaveBeenCalledWith(
    HOME,
    expect.objectContaining({
      arguments: ["auth", "login", "--claudeai"],
      onChallenge,
    }),
  );
});

it("maps process results of a login to error codes", () => {
  const { cli } = create();
  expect(cli.loginError(result({ errorCode: "check_timeout" }))).toBe(
    "login_expired",
  );
  expect(cli.loginError(result({ errorCode: "cli_check_failed" }))).toBe(
    "cli_check_failed",
  );
  expect(cli.loginError(result({ stderr: "Login failed: error 400" }))).toBe(
    "login_code_rejected",
  );
  expect(cli.loginError(result({ stdout: "Login failed: nothing" }))).toBe(
    "login_failed",
  );
});

it("runs the model test with optional model and effort", async () => {
  const { cli, execution } = create();
  const run = vi.spyOn(execution, "run");
  run.mockResolvedValueOnce(result({ errorCode: "check_timeout" }));
  await expect(
    cli.runTest(HOME, { model: null, reasoningEffort: null }, SIGNAL),
  ).resolves.toEqual({ ok: false, errorCode: "check_timeout", detail: {} });
  mocks.readClaudeTest.mockReturnValue({ ok: true, detail: {} });
  run.mockResolvedValueOnce(result({ stdout: "out" }));
  await expect(
    cli.runTest(HOME, { model: null, reasoningEffort: null }, SIGNAL),
  ).resolves.toEqual({ ok: true, detail: {} });
  expect(run.mock.calls[1][1]).not.toContain("--model");
  run.mockResolvedValueOnce(result({ stdout: "out" }));
  await cli.runTest(HOME, { model: "m", reasoningEffort: "high" }, SIGNAL);
  expect(run.mock.calls[2][1]).toEqual(
    expect.arrayContaining(["--model", "m", "--effort", "high"]),
  );
  expect(run.mock.calls[2][3]).toBe(45_000);
});

it("lists the models through the SDK initialization", async () => {
  const { cli, execution } = create();
  const catalog = vi.spyOn(execution, "readCatalog");
  catalog.mockResolvedValueOnce(result({ errorCode: "check_timeout" }));
  await expect(cli.listModels(HOME, SIGNAL)).rejects.toEqual(
    new AgentError("check_timeout"),
  );
  catalog.mockResolvedValueOnce(result({ exitCode: 2 }));
  await expect(cli.listModels(HOME, SIGNAL)).rejects.toEqual(
    new AgentError("cli_unexpected_output"),
  );
  mocks.readClaudeModels.mockReturnValue([]);
  catalog.mockResolvedValueOnce(result({ stdout: "models" }));
  await expect(cli.listModels(HOME, SIGNAL)).resolves.toEqual([]);
  expect(mocks.readClaudeModels).toHaveBeenCalledWith("models");
  expect(catalog.mock.calls[2][3]).toContain("pages-model-catalog");
});

it("reads the usage through control requests with the usage environment", async () => {
  const { cli, execution } = create();
  const exchange = vi.spyOn(execution, "exchange");
  exchange.mockResolvedValueOnce(result({ errorCode: "check_timeout" }));
  await expect(cli.readUsage(HOME, SIGNAL)).rejects.toEqual(
    new AgentError("check_timeout"),
  );
  exchange.mockResolvedValueOnce(result({ exitCode: 1 }));
  await expect(cli.readUsage(HOME, SIGNAL)).rejects.toEqual(
    new AgentError("cli_unexpected_output"),
  );
  const reading = { plan: "max", windows: null };
  mocks.readClaudeUsage.mockReturnValue(reading);
  exchange.mockResolvedValueOnce(result({ stdout: "usage" }));
  await expect(cli.readUsage(HOME, SIGNAL)).resolves.toBe(reading);
  const sent = exchange.mock.calls[2][1];
  expect(sent.environment).toMatchObject({
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "",
  });
  expect(sent.requests).toHaveLength(2);
  expect(sent.requests[1]).toContain("get_usage");
  expect(
    sent.isAnswer(
      JSON.stringify({
        type: "control_response",
        response: { request_id: "pages-usage" },
      }),
    ),
  ).toBe(true);
});

it("logs out and maps the exit state", async () => {
  const { cli, execution } = create();
  const run = vi.spyOn(execution, "run");
  run.mockResolvedValueOnce(result({ errorCode: "check_timeout" }));
  await expect(cli.logout(HOME, SIGNAL)).resolves.toEqual({
    ok: false,
    errorCode: "check_timeout",
    detail: {},
  });
  run.mockResolvedValueOnce(result());
  await expect(cli.logout(HOME, SIGNAL)).resolves.toEqual({
    ok: true,
    detail: {},
  });
  run.mockResolvedValueOnce(result({ exitCode: 1 }));
  await expect(cli.logout(HOME, SIGNAL)).resolves.toEqual({
    ok: false,
    errorCode: "cli_check_failed",
    detail: {},
  });
});
