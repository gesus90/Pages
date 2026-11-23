import { beforeEach, expect, it, vi } from "vitest";

import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import type { CliHome } from "@/backend/agents/cli/CliContracts";
import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";

const mocks = vi.hoisted(() => {
  const make = (name: string): ReturnType<typeof vi.fn> =>
    vi.fn(function (this: Record<string, unknown>, ...args: unknown[]) {
      Object.assign(this, mocks.behavior, { kind: name, args });
    });
  const behavior: Record<string, unknown> = {};
  return {
    behavior,
    logCaughtError: vi.fn(),
    prepareCliUsageHome: vi.fn(),
    CodexCli: make("codex"),
    ClaudeCodeCli: make("claude"),
    AntigravityCli: make("antigravity"),
    OpenCodeCli: make("opencode"),
    CliToolExecution: make("execution"),
  };
});

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));
vi.mock("@/backend/agents/cli/CodexCli", () => ({ CodexCli: mocks.CodexCli }));
vi.mock("@/backend/agents/cli/ClaudeCodeCli", () => ({
  ClaudeCodeCli: mocks.ClaudeCodeCli,
}));
vi.mock("@/backend/agents/cli/AntigravityCli", () => ({
  AntigravityCli: mocks.AntigravityCli,
}));
vi.mock("@/backend/agents/cli/OpenCodeCli", () => ({
  OpenCodeCli: mocks.OpenCodeCli,
}));
vi.mock("@/backend/agents/cli/CliToolExecution", () => ({
  CliToolExecution: mocks.CliToolExecution,
}));
vi.mock("@/backend/agents/cli/CliUsageHome", () => ({
  prepareCliUsageHome: mocks.prepareCliUsageHome,
}));

const HOME: CliHome = {
  root: "/r",
  home: "/r/home",
  config: "/r/config",
  work: "/r/work",
};
const SIGNAL = new AbortController().signal;
const OK = { ok: true, detail: { own: "outcome" } };

const adapter = {
  version: vi.fn(),
  readStatus: vi.fn(),
  runTest: vi.fn(),
  listModels: vi.fn(),
  logout: vi.fn(),
  readUsage: vi.fn(),
};
const store = {
  paths: vi.fn(),
  prepare: vi.fn(),
  secure: vi.fn(),
  remove: vi.fn(),
  isBound: vi.fn(),
};
const locator = { find: vi.fn() };
const runner = { hasSession: vi.fn() };
const tools = { ensureProvider: vi.fn() };
const cipher = { synthetic: true };

function connection(
  overrides: Partial<AgentConnectionRecord> = {},
): AgentConnectionRecord {
  return {
    id: "connection-1",
    provider: "codex_cli",
    cliLoggedInAt: "2026-01-01T00:00:00.000Z",
    testModel: "model-a",
    reasoningEffort: "high",
    ...overrides,
  } as unknown as AgentConnectionRecord;
}

function runtimeOf(withTools = false): AgentCliRuntime {
  return new AgentCliRuntime({
    store: store as unknown as AgentCredentialStore,
    locator: locator as unknown as CliLocator,
    runner: runner as unknown as CliProcessRunner,
    cipher: cipher as never,
    ...(withTools
      ? { tools: tools as unknown as AgentToolManagerService }
      : {}),
  });
}

beforeEach(() => {
  Object.assign(mocks.behavior, adapter);
  store.paths.mockReturnValue(HOME);
  store.prepare.mockResolvedValue(HOME);
  store.secure.mockResolvedValue(undefined);
  store.remove.mockResolvedValue(undefined);
  store.isBound.mockReturnValue(false);
  locator.find.mockResolvedValue({ path: "/synthetic/cli" });
  runner.hasSession.mockReturnValue(false);
  tools.ensureProvider.mockResolvedValue({ file: "/synthetic/managed" });
  adapter.version.mockResolvedValue({ ok: true, detail: { version: "1" } });
  adapter.readStatus.mockResolvedValue({ outcome: OK });
  adapter.runTest.mockResolvedValue({ ok: true, detail: { test: "yes" } });
  adapter.listModels.mockResolvedValue([{ id: "m" }]);
  adapter.logout.mockResolvedValue(undefined);
  adapter.readUsage.mockImplementation(async (home: CliHome) => ({ home }));
});

it("resolves each provider adapter through the located CLI", async () => {
  const runtime = runtimeOf();

  expect(await runtime.adapter("codex_cli")).toMatchObject({ kind: "codex" });
  expect(await runtime.adapter("claude_code")).toMatchObject({
    kind: "claude",
  });
  expect(await runtime.adapter("antigravity")).toMatchObject({
    kind: "antigravity",
  });
  expect(await runtime.adapter("opencode")).toMatchObject({
    kind: "opencode",
    args: [expect.anything(), cipher],
  });
  expect(mocks.CliToolExecution).toHaveBeenCalledWith(
    runner,
    "/synthetic/cli",
    "codex_cli",
  );
});

it("pins a given file and prefers the verified generation of the tool manager", async () => {
  await runtimeOf(true).adapter("codex_cli", "/pinned/cli");
  expect(mocks.CliToolExecution).toHaveBeenLastCalledWith(
    runner,
    "/pinned/cli",
    "codex_cli",
  );
  expect(tools.ensureProvider).not.toHaveBeenCalled();

  await runtimeOf(true).adapter("codex_cli");
  expect(mocks.CliToolExecution).toHaveBeenLastCalledWith(
    runner,
    "/synthetic/managed",
    "codex_cli",
  );
  expect(locator.find).not.toHaveBeenCalled();
});

it("fails when no CLI is found", async () => {
  locator.find.mockResolvedValue({ path: null });

  await expect(runtimeOf().adapter("codex_cli")).rejects.toMatchObject({
    code: "cli_not_found",
  });
});

it("resolves login adapters and refuses OpenCode", async () => {
  const runtime = runtimeOf();

  expect(await runtime.loginAdapter("antigravity")).toMatchObject({
    kind: "antigravity",
  });
  expect(await runtime.loginAdapter("codex_cli")).toMatchObject({
    kind: "codex",
  });
  expect(await runtime.loginAdapter("claude_code")).toMatchObject({
    kind: "claude",
  });
  await expect(runtime.loginAdapter("opencode")).rejects.toMatchObject({
    code: "provider_invalid",
  });
});

it("resolves the OpenCode adapter", async () => {
  expect(await runtimeOf().openCode()).toMatchObject({ kind: "opencode" });
});

it("runs version, status and the model test and merges their details", async () => {
  const outcome = await runtimeOf().check(connection(), "model", SIGNAL);

  expect(adapter.runTest).toHaveBeenCalledWith(
    HOME,
    { model: "model-a", reasoningEffort: "high" },
    SIGNAL,
  );
  expect(store.secure).toHaveBeenCalledWith("connection-1", "codex_cli");
  expect(outcome).toEqual({
    ok: true,
    detail: { test: "yes", version: "1" },
  });
});

it("skips the model test for a status check or a failed status", async () => {
  const runtime = runtimeOf();

  expect(await runtime.check(connection(), "auth", SIGNAL)).toEqual({
    ...OK,
    detail: { own: "outcome", version: "1" },
  });
  adapter.readStatus.mockResolvedValue({ outcome: { ok: false, detail: {} } });
  await runtime.check(connection(), "model", SIGNAL);
  expect(adapter.runTest).not.toHaveBeenCalled();
});

it("adds the status detail of OpenCode", async () => {
  adapter.runTest.mockResolvedValue({ ok: true, detail: {} });
  adapter.readStatus.mockResolvedValue({
    outcome: { ok: true, detail: { status: "s" } },
  });

  const outcome = await runtimeOf().check(
    connection({ provider: "opencode" }),
    "model",
    SIGNAL,
  );

  expect(outcome.detail).toEqual({ status: "s", version: "1" });
});

it("returns a failed version check without a status read", async () => {
  const failed = { ok: false, errorCode: "cli_not_found", detail: {} };
  adapter.version.mockResolvedValue(failed);

  expect(await runtimeOf().check(connection(), "auth", SIGNAL)).toBe(failed);
  expect(adapter.readStatus).not.toHaveBeenCalled();
});

it("defers the check while a session uses the home and rejects API providers", async () => {
  runner.hasSession.mockReturnValue(true);
  expect(await runtimeOf().check(connection(), "auth", SIGNAL)).toEqual({
    ok: false,
    errorCode: "check_in_progress",
    detail: {},
  });
  await expect(
    runtimeOf().check(connection({ provider: "openai" }), "auth", SIGNAL),
  ).rejects.toMatchObject({ code: "provider_invalid" });
});

it("turns an agent error of a check into a failed outcome and rethrows others", async () => {
  adapter.version.mockRejectedValue(new AgentError("cli_not_executable"));
  expect(await runtimeOf().check(connection(), "auth", SIGNAL)).toEqual({
    ok: false,
    errorCode: "cli_not_executable",
    detail: {},
  });

  const failure = new Error("unexpected");
  adapter.version.mockRejectedValue(failure);
  await expect(runtimeOf().check(connection(), "auth", SIGNAL)).rejects.toBe(
    failure,
  );
  expect(mocks.logCaughtError).toHaveBeenCalledWith("AgentCliRuntime", failure);
});

it("lists models only for a signed-in CLI connection", async () => {
  expect(await runtimeOf().listModels(connection(), SIGNAL)).toEqual([
    { id: "m" },
  ]);
  expect(store.secure).toHaveBeenCalledTimes(1);
  await expect(
    runtimeOf().listModels(connection({ provider: "openai" }), SIGNAL),
  ).rejects.toMatchObject({ code: "provider_invalid" });
  await expect(
    runtimeOf().listModels(connection({ cliLoggedInAt: null }), SIGNAL),
  ).rejects.toMatchObject({ code: "cli_not_logged_in" });
});

it("reads Claude and Codex usage in the connection home without a session", async () => {
  const claude = connection({ provider: "claude_code" });

  expect(await runtimeOf().readClaudeUsage(claude, SIGNAL)).toEqual({
    home: HOME,
  });
  expect(await runtimeOf().readCodexUsage(connection(), SIGNAL)).toEqual({
    home: HOME,
  });
  expect(mocks.prepareCliUsageHome).not.toHaveBeenCalled();
  expect(store.secure).toHaveBeenCalledTimes(2);
});

it("reads usage in a private home while a session holds the connection home", async () => {
  const usageHome = { ...HOME, root: "/usage" };
  const release = vi.fn(async () => undefined);
  mocks.prepareCliUsageHome.mockResolvedValue({ home: usageHome, release });
  runner.hasSession.mockReturnValue(true);

  const reading = await runtimeOf().readClaudeUsage(
    connection({ provider: "claude_code" }),
    SIGNAL,
  );

  expect(reading).toEqual({ home: usageHome });
  expect(mocks.prepareCliUsageHome).toHaveBeenCalledWith(
    HOME,
    ".credentials.json",
  );
  await runtimeOf().readCodexUsage(connection(), SIGNAL);
  expect(mocks.prepareCliUsageHome).toHaveBeenLastCalledWith(HOME, "auth.json");
  expect(release).toHaveBeenCalledTimes(2);
});

it("releases and secures even when a usage query fails", async () => {
  const release = vi.fn(async () => undefined);
  mocks.prepareCliUsageHome.mockResolvedValue({ home: HOME, release });
  runner.hasSession.mockReturnValue(true);
  adapter.readUsage.mockRejectedValue(new Error("query failed"));

  await expect(
    runtimeOf().readCodexUsage(connection(), SIGNAL),
  ).rejects.toThrow("query failed");
  expect(release).toHaveBeenCalledTimes(1);
  expect(store.secure).toHaveBeenCalledTimes(1);
});

it("refuses usage queries for the wrong provider or before login", async () => {
  await expect(
    runtimeOf().readClaudeUsage(connection(), SIGNAL),
  ).rejects.toMatchObject({ code: "provider_invalid" });
  await expect(
    runtimeOf().readClaudeUsage(
      connection({ provider: "claude_code", cliLoggedInAt: null }),
      SIGNAL,
    ),
  ).rejects.toMatchObject({ code: "cli_not_logged_in" });
  await expect(
    runtimeOf().readCodexUsage(connection({ provider: "claude_code" }), SIGNAL),
  ).rejects.toMatchObject({ code: "provider_invalid" });
  await expect(
    runtimeOf().readCodexUsage(connection({ cliLoggedInAt: null }), SIGNAL),
  ).rejects.toMatchObject({ code: "cli_not_logged_in" });
  await expect(
    runtimeOf().readAntigravityUsage(connection(), SIGNAL),
  ).rejects.toMatchObject({ code: "provider_invalid" });
  await expect(
    runtimeOf().readAntigravityUsage(
      connection({ provider: "antigravity", cliLoggedInAt: null }),
      SIGNAL,
    ),
  ).rejects.toMatchObject({ code: "cli_not_logged_in" });
});

it("reads Antigravity usage and secures the home afterwards", async () => {
  const groups = [{ name: "group" }];
  adapter.readUsage.mockResolvedValue(groups);
  const antigravity = connection({ provider: "antigravity" });

  expect(await runtimeOf().readAntigravityUsage(antigravity, SIGNAL)).toBe(
    groups,
  );
  expect(store.secure).toHaveBeenCalledTimes(1);

  adapter.readUsage.mockRejectedValue(new Error("failed"));
  await expect(
    runtimeOf().readAntigravityUsage(antigravity, SIGNAL),
  ).rejects.toThrow("failed");
  expect(store.secure).toHaveBeenCalledTimes(2);
});

it("defers Antigravity usage while a session uses the home", async () => {
  runner.hasSession.mockReturnValue(true);

  await expect(
    runtimeOf().readAntigravityUsage(
      connection({ provider: "antigravity" }),
      SIGNAL,
    ),
  ).rejects.toMatchObject({ code: "check_in_progress" });
});

it("logs out and removes the local credentials", async () => {
  await runtimeOf().cleanup(connection());

  expect(adapter.logout).toHaveBeenCalledWith(HOME, expect.any(AbortSignal));
  expect(store.remove).toHaveBeenCalledWith("connection-1", "codex_cli");
});

it("removes the local credentials even when the logout fails", async () => {
  const failure = new Error("no cli");
  adapter.logout.mockRejectedValue(failure);

  await runtimeOf().cleanup(connection());

  expect(mocks.logCaughtError).toHaveBeenCalledWith("AgentCliRuntime", failure);
  expect(store.remove).toHaveBeenCalledTimes(1);
});

it("leaves a bound context alone and rejects API providers on cleanup", async () => {
  store.isBound.mockReturnValue(true);
  await runtimeOf().cleanup(connection({ provider: "antigravity" }));
  expect(store.remove).not.toHaveBeenCalled();

  await expect(
    runtimeOf().cleanup(connection({ provider: "openai" })),
  ).rejects.toMatchObject({ code: "provider_invalid" });
});
