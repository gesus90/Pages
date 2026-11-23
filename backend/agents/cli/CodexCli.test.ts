import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

const mocks = vi.hoisted(() => ({
  readCodexTest: vi.fn(),
  readCodexModels: vi.fn(),
  readCodexUsage: vi.fn(),
}));

vi.mock("./CliResultParser", () => ({ readCodexTest: mocks.readCodexTest }));
vi.mock("./CliModelCatalog", () => ({
  readCodexModels: mocks.readCodexModels,
}));
vi.mock("./CodexUsageResult", async (importOriginal) => ({
  ...(await importOriginal<typeof CodexUsageResultModule>()),
  readCodexUsage: mocks.readCodexUsage,
}));

import { CliProcessRunner } from "./CliProcessRunner";
import { CliToolExecution } from "./CliToolExecution";
import { CodexCli } from "./CodexCli";

import type * as CodexUsageResultModule from "./CodexUsageResult";
import type {
  CliHome,
  CliProcessResult,
  CliRunningProcess,
} from "./CliContracts";

const HOME: CliHome = {
  root: "/synthetic",
  home: "/synthetic/home",
  config: "/synthetic/codex",
  work: "/synthetic/work",
};
const SIGNAL = new AbortController().signal;

function result(overrides: Partial<CliProcessResult> = {}): CliProcessResult {
  return { exitCode: 0, stdout: "", stderr: "", errorCode: null, ...overrides };
}

function create(): { cli: CodexCli; execution: CliToolExecution } {
  const execution = new CliToolExecution(
    new CliProcessRunner(),
    "codex",
    "codex_cli",
  );
  return { cli: new CodexCli(execution), execution };
}

beforeEach(() => {
  mocks.readCodexTest.mockReset();
});

it("reads the status from the local login output", async () => {
  const { cli, execution } = create();
  const run = vi.spyOn(execution, "run");
  run.mockResolvedValueOnce(result({ errorCode: "check_timeout" }));
  await expect(cli.readStatus(HOME, SIGNAL)).resolves.toEqual({
    outcome: { ok: false, errorCode: "check_timeout", detail: {} },
    accountLabel: null,
  });
  run.mockResolvedValueOnce(result({ stderr: "Logged in using ChatGPT" }));
  await expect(cli.readStatus(HOME, SIGNAL)).resolves.toEqual({
    outcome: { ok: true, detail: { authMethod: "chatgpt" } },
    accountLabel: null,
  });
  run.mockResolvedValueOnce(result({ exitCode: 1, stdout: "Not logged in" }));
  expect((await cli.readStatus(HOME, SIGNAL)).outcome).toEqual({
    ok: false,
    errorCode: "cli_not_logged_in",
    detail: {},
  });
  run.mockResolvedValueOnce(result({ stdout: "Logged in using an API key" }));
  expect((await cli.readStatus(HOME, SIGNAL)).outcome).toEqual({
    ok: false,
    errorCode: "cli_unexpected_output",
    detail: {},
  });
});

it("delegates the version and the login start to the shared execution", () => {
  const { cli, execution } = create();
  const outcome = Promise.resolve({ ok: true as const, detail: {} });
  vi.spyOn(execution, "version").mockReturnValue(outcome);
  expect(cli.version(HOME, SIGNAL)).toBe(outcome);
  const running: CliRunningProcess = {
    cancel: vi.fn(),
    write: vi.fn(() => true),
    completed: Promise.resolve(result()),
  };
  const start = vi.spyOn(execution, "startLogin").mockReturnValue(running);
  const onChallenge = vi.fn();
  expect(cli.startLogin(HOME, onChallenge)).toBe(running);
  expect(start.mock.calls[0][1].arguments).toContain("--device-auth");
});

it("maps process results of a login to error codes", () => {
  const { cli } = create();
  expect(cli.loginError(result({ errorCode: "check_timeout" }))).toBe(
    "login_expired",
  );
  expect(cli.loginError(result({ errorCode: "cli_check_failed" }))).toBe(
    "cli_check_failed",
  );
  expect(cli.loginError(result({ stderr: "device flow not enabled" }))).toBe(
    "login_device_auth_unavailable",
  );
  expect(cli.loginError(result({ stdout: "boom" }))).toBe("login_failed");
});

it("runs the model test with optional model and effort", async () => {
  const { cli, execution } = create();
  const run = vi.spyOn(execution, "run");
  run.mockResolvedValueOnce(result({ errorCode: "check_timeout" }));
  await expect(
    cli.runTest(HOME, { model: null, reasoningEffort: null }, SIGNAL),
  ).resolves.toEqual({ ok: false, errorCode: "check_timeout", detail: {} });
  mocks.readCodexTest.mockReturnValue({ ok: true, detail: {} });
  run.mockResolvedValueOnce(result({ stdout: "out" }));
  await expect(
    cli.runTest(HOME, { model: null, reasoningEffort: null }, SIGNAL),
  ).resolves.toEqual({ ok: true, detail: {} });
  expect(run.mock.calls[1][1]).not.toContain("-m");
  run.mockResolvedValueOnce(result({ stdout: "out" }));
  await cli.runTest(HOME, { model: "m", reasoningEffort: "high" }, SIGNAL);
  expect(run.mock.calls[2][1]).toEqual(
    expect.arrayContaining(["-m", "m", 'model_reasoning_effort="high"']),
  );
  expect(run.mock.calls[2][3]).toBe(45_000);
});

it("lists the models of the connection's own login", async () => {
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
  mocks.readCodexModels.mockReturnValue([]);
  catalog.mockResolvedValueOnce(result({ stdout: "models" }));
  await expect(cli.listModels(HOME, SIGNAL)).resolves.toEqual([]);
  expect(mocks.readCodexModels).toHaveBeenCalledWith("models");
});

it("reads the usage from the app server handshake and request", async () => {
  const { cli, execution } = create();
  const exchange = vi.spyOn(execution, "exchange");
  exchange.mockResolvedValueOnce(result({ errorCode: "check_timeout" }));
  await expect(cli.readUsage(HOME, SIGNAL)).rejects.toEqual(
    new AgentError("check_timeout"),
  );
  const reading = { plan: null, windows: [], isLimitReached: false };
  mocks.readCodexUsage.mockReturnValue(reading);
  exchange.mockResolvedValueOnce(result({ stdout: "usage" }));
  await expect(cli.readUsage(HOME, SIGNAL)).resolves.toBe(reading);
  const sent = exchange.mock.calls[1][1];
  expect(sent.arguments[0]).toBe("app-server");
  expect(sent.requests).toHaveLength(3);
  expect(sent.isAnswer(JSON.stringify({ id: 2, result: {} }))).toBe(true);
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
