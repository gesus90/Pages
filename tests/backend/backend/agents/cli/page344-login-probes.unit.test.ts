import { expect, it, vi } from "vitest";

import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliToolExecution } from "@/backend/agents/cli/CliToolExecution";
import { CodexCli } from "@/backend/agents/cli/CodexCli";

import { fakeChild } from "./fake-child-process";

import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";

const connection: AgentConnectionRecord = {
  id: "aa37e4ca-42c7-4d3c-b6a4-57012056ed92",
  provider: "codex_cli",
  name: "Synthetic",
  isActive: true,
  hasApiKey: false,
  testModel: null,
  reasoningEffort: null,
  cliLoggedInAt: "2026-11-13",
  cliAccountLabel: null,
  updatedAt: "2026-11-13",
};

function fixture(): {
  runtime: AgentCliRuntime;
  runner: CliProcessRunner;
  store: AgentCredentialStore;
  adapter: CodexCli;
} {
  const runner = new CliProcessRunner();
  const store = new AgentCredentialStore("/synthetic");
  const home = store.paths(connection.id, "codex_cli");
  vi.spyOn(store, "prepare").mockResolvedValue(home);
  vi.spyOn(store, "secure").mockResolvedValue(undefined);
  const adapter = new CodexCli(
    new CliToolExecution(runner, "/synthetic/codex", "codex_cli"),
  );
  const runtime = new AgentCliRuntime({
    store,
    runner,
    locator: new CliLocator(""),
  });
  vi.spyOn(runtime, "adapter").mockResolvedValue(adapter);
  return { runtime, runner, store, adapter };
}

it("PAGE-344 defers a login probe while the connection's native session is answering", async () => {
  const { runtime, runner, store } = fixture();
  const active = vi.spyOn(runner, "hasSession").mockReturnValue(true);
  const run = vi.spyOn(runner, "run");
  await expect(
    runtime.check(connection, "auth", new AbortController().signal),
  ).resolves.toMatchObject({ ok: false, errorCode: "check_in_progress" });
  expect(active).toHaveBeenCalledWith(store.paths(connection.id, "codex_cli"));
  expect(run).not.toHaveBeenCalled();
  expect(store.prepare).not.toHaveBeenCalled();
  expect(store.secure).not.toHaveBeenCalled();
  expect(runtime.adapter).not.toHaveBeenCalled();
});

it.each([
  ["Not logged in", 1, "cli_not_logged_in"],
  ["temporary credential refresh failure", 1, "cli_unexpected_output"],
  ["", 0, "cli_unexpected_output"],
] as const)(
  "PAGE-344 classifies status %s without inventing sign-out",
  async (stderr, exitCode, errorCode) => {
    const { adapter, runner, store } = fixture();
    vi.spyOn(runner, "run").mockResolvedValue({
      stdout: "",
      stderr,
      exitCode,
      errorCode: null,
    });
    await expect(
      adapter.readStatus(
        store.paths(connection.id, "codex_cli"),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ outcome: { ok: false, errorCode } });
  },
);

it("PAGE-344 probes the exact same credential HOME again after the session rests", async () => {
  const { runtime, runner, store } = fixture();
  vi.spyOn(runner, "hasSession").mockReturnValue(false);
  const run = vi
    .spyOn(runner, "run")
    .mockResolvedValueOnce({
      stdout: "codex 1.0.0",
      stderr: "",
      exitCode: 0,
      errorCode: null,
    })
    .mockResolvedValueOnce({
      stdout: "",
      stderr: "Logged in using ChatGPT",
      exitCode: 0,
      errorCode: null,
    });
  await expect(
    runtime.check(connection, "auth", new AbortController().signal),
  ).resolves.toMatchObject({ ok: true });
  expect(run).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenLastCalledWith(
    expect.objectContaining({
      home: store.paths(connection.id, "codex_cli"),
    }),
  );
  expect(run.mock.lastCall?.[0].arguments).toEqual(
    expect.arrayContaining(["login", "status"]),
  );
});

it("PAGE-344 tracks only the native session's own HOME and releases it when the mocked process ends", async () => {
  const fake = fakeChild();
  const runner = new CliProcessRunner({
    spawn: () => fake.child,
    signalGroup: vi.fn(),
  });
  const store = new AgentCredentialStore("/synthetic");
  const home = store.paths(connection.id, "codex_cli");
  expect(runner.hasSession(home)).toBe(false);
  const session = runner.startSession({
    file: "/synthetic/codex",
    provider: "codex_cli",
    home,
    workingDirectory: home.work,
    arguments: [],
    environment: {},
    timeoutMs: 0,
    signal: new AbortController().signal,
    onLine: vi.fn(),
  });
  expect(runner.hasSession(home)).toBe(true);
  expect(runner.hasSession({ ...home, root: "/other/connection" })).toBe(false);
  fake.child.emit("close", 0, null);
  await session.completed;
  expect(runner.hasSession(home)).toBe(false);
});
