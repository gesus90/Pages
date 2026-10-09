import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { AgentError } from "@/backend/error/AgentErrors";
import { CLI_HOME, createCliSpawn } from "../helpers/agent-cli";
import { createCatalogModel } from "../helpers/agents";

import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { CliToolAdapter } from "@/backend/agents/cli/CliContracts";

let directory = "";
beforeEach(async () => {
  directory = await filesystem.mkdtemp(
    path.join(tmpdir(), "pages-cli-runtime-"),
  );
});
afterEach(async () => {
  await filesystem.rm(directory, { recursive: true, force: true });
});

const CONNECTION: AgentConnectionRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Test",
  provider: "codex_cli",
  hasApiKey: false,
  testModel: null,
  reasoningEffort: null,
  cliLoggedInAt: null,
  cliAccountLabel: null,
  updatedAt: "now",
};

function setup() {
  const store = new AgentCredentialStore(directory);
  const locator = new CliLocator("/not-installed", "/not-installed/node");
  const runner = new CliProcessRunner(createCliSpawn());
  const runtime = new AgentCliRuntime({ store, locator, runner });
  const adapter: CliToolAdapter = {
    provider: "codex_cli",
    version: vi
      .fn()
      .mockResolvedValue({ ok: true, detail: { cliVersion: "1.2.3" } }),
    readStatus: vi.fn().mockResolvedValue({
      outcome: { ok: true, detail: { authMethod: "chatgpt" } },
      accountLabel: null,
    }),
    runTest: vi
      .fn()
      .mockResolvedValue({ ok: true, detail: { inputTokens: 3 } }),
    listModels: vi.fn().mockResolvedValue([createCatalogModel()]),
    logout: vi.fn().mockResolvedValue({
      ok: false,
      errorCode: "cli_check_failed",
      detail: {},
    }),
    startLogin: vi.fn(),
    loginError: vi.fn(),
  };
  return {
    store,
    locator,
    runner,
    runtime,
    adapter,
    signal: new AbortController().signal,
  };
}

describe("isolated CLI runtime", () => {
  it("selects only the matching installed CLI and never installs a missing tool", async () => {
    const { locator, runtime } = setup();
    await expect(runtime.adapter("codex_cli")).rejects.toMatchObject({
      code: "cli_not_found",
    });
    vi.spyOn(locator, "find").mockResolvedValue({
      found: true,
      path: "/fake/cli",
    });
    expect((await runtime.adapter("codex_cli")).provider).toBe("codex_cli");
    expect((await runtime.adapter("claude_code")).provider).toBe("claude_code");
  });

  it("runs version and local status before a model test with one shared signal", async () => {
    const { runtime, adapter, signal } = setup();
    vi.spyOn(runtime, "adapter").mockResolvedValue(adapter);
    expect(await runtime.check(CONNECTION, "auth", signal)).toEqual({
      ok: true,
      detail: { cliVersion: "1.2.3", authMethod: "chatgpt" },
    });
    expect(adapter.runTest).not.toHaveBeenCalled();
    expect(await runtime.check(CONNECTION, "model", signal)).toEqual({
      ok: true,
      detail: { cliVersion: "1.2.3", inputTokens: 3 },
    });
    expect(adapter.runTest).toHaveBeenCalledWith(
      expect.objectContaining({ work: expect.stringContaining("/work") }),
      { model: null, reasoningEffort: null },
      signal,
    );
    vi.mocked(adapter.version).mockResolvedValueOnce({
      ok: false,
      errorCode: "check_timeout",
      detail: {},
    });
    expect(await runtime.check(CONNECTION, "model", signal)).toMatchObject({
      errorCode: "check_timeout",
    });
    vi.mocked(adapter.readStatus).mockResolvedValueOnce({
      outcome: { ok: false, errorCode: "cli_not_logged_in", detail: {} },
      accountLabel: null,
    });
    expect(await runtime.check(CONNECTION, "model", signal)).toMatchObject({
      errorCode: "cli_not_logged_in",
    });
    expect(adapter.runTest).toHaveBeenCalledTimes(1);
  });

  it("passes the saved model and effort to the CLI test", async () => {
    const { runtime, adapter, signal } = setup();
    vi.spyOn(runtime, "adapter").mockResolvedValue(adapter);
    await runtime.check(
      { ...CONNECTION, testModel: "vendor-large", reasoningEffort: "high" },
      "model",
      signal,
    );
    expect(adapter.runTest).toHaveBeenCalledWith(
      expect.anything(),
      { model: "vendor-large", reasoningEffort: "high" },
      signal,
    );
  });

  it("lists models only for signed-in CLI connections in their own directory", async () => {
    const { runtime, adapter, store, signal } = setup();
    vi.spyOn(runtime, "adapter").mockResolvedValue(adapter);
    const secure = vi.spyOn(store, "secure");
    await expect(runtime.listModels(CONNECTION, signal)).rejects.toMatchObject({
      code: "cli_not_logged_in",
    });
    await expect(
      runtime.listModels(
        { ...CONNECTION, provider: "openrouter", cliLoggedInAt: "now" },
        signal,
      ),
    ).rejects.toMatchObject({ code: "provider_invalid" });
    expect(adapter.listModels).not.toHaveBeenCalled();
    const signedIn = { ...CONNECTION, cliLoggedInAt: "now" };
    expect(await runtime.listModels(signedIn, signal)).toEqual([
      createCatalogModel(),
    ]);
    expect(adapter.listModels).toHaveBeenCalledWith(
      expect.objectContaining({ root: expect.stringContaining(CONNECTION.id) }),
      signal,
    );
    expect(secure).toHaveBeenCalledWith(CONNECTION.id, "codex_cli");
    vi.mocked(adapter.listModels).mockRejectedValueOnce(
      new AgentError("cli_unexpected_output"),
    );
    await expect(runtime.listModels(signedIn, signal)).rejects.toMatchObject({
      code: "cli_unexpected_output",
    });
  });

  it("returns known errors safely but surfaces programming failures", async () => {
    const { runtime, signal } = setup();
    expect(await runtime.check(CONNECTION, "auth", signal)).toMatchObject({
      errorCode: "cli_not_found",
    });
    vi.spyOn(runtime, "adapter").mockRejectedValue(
      new Error("programming failure"),
    );
    await expect(runtime.check(CONNECTION, "auth", signal)).rejects.toThrow(
      "programming failure",
    );
    await expect(
      runtime.check({ ...CONNECTION, provider: "openai" }, "auth", signal),
    ).rejects.toMatchObject({ code: "provider_invalid" });
  });

  it("deletes the local directory even when logout fails or a binary has disappeared", async () => {
    const { runtime, store, adapter } = setup();
    vi.spyOn(runtime, "adapter").mockResolvedValue(adapter);
    const home = await store.prepare(CONNECTION.id, "codex_cli");
    await filesystem.writeFile(
      path.join(home.config, "auth.json"),
      "synthetic-token",
    );
    await runtime.cleanup(CONNECTION);
    expect(adapter.logout).toHaveBeenCalled();
    await expect(filesystem.stat(home.root)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await store.prepare(CONNECTION.id, "codex_cli");
    vi.mocked(runtime.adapter).mockRejectedValueOnce(
      new AgentError("cli_not_found"),
    );
    await runtime.cleanup(CONNECTION);
    await expect(filesystem.stat(home.root)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      runtime.cleanup({ ...CONNECTION, provider: "openai" }),
    ).rejects.toMatchObject({ code: "provider_invalid" });
    vi.spyOn(store, "remove").mockRejectedValueOnce(
      new AgentError("credential_cleanup_failed"),
    );
    await expect(runtime.cleanup(CONNECTION)).rejects.toMatchObject({
      code: "credential_cleanup_failed",
    });
  });

  it("does not spawn when credential setup fails", async () => {
    const { runtime, store, adapter, signal } = setup();
    vi.spyOn(runtime, "adapter").mockResolvedValue(adapter);
    vi.spyOn(store, "prepare").mockRejectedValueOnce(
      new AgentError("cli_not_executable"),
    );
    expect(await runtime.check(CONNECTION, "auth", signal)).toMatchObject({
      errorCode: "cli_not_executable",
    });
    expect(adapter.version).not.toHaveBeenCalled();
    expect(CLI_HOME.work).not.toContain(directory);
  });
});
