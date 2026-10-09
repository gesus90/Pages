import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import {
  AgentAccessDeniedError,
  AgentError,
} from "@/backend/error/AgentErrors";
import { AgentCliLoginService } from "@/backend/service/agents/AgentCliLoginService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { CliLoginSessionRegistry } from "@/backend/service/agents/CliLoginSessionRegistry";

import { createAccess } from "../helpers/authorization";
import { createCliSpawn } from "../helpers/agent-cli";
import { useMigratedDatabase } from "../helpers/test-database";

import type {
  CliProcessResult,
  CliToolAdapter,
  CliRunningProcess,
} from "@/backend/agents/cli/CliContracts";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { CliLoginSession } from "@/backend/service/agents/CliLoginSessionRegistry";

const ADMIN = createAccess({ isAdmin: true, mode: "admin" });
const ID = "00000000-0000-4000-8000-000000000001";
const RESULT: CliProcessResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  errorCode: null,
};
const locations = {
  codex_cli: { found: true, path: "/fake/codex" },
  claude_code: { found: true, path: "/fake/claude" },
};
let directory = "";
const services: AgentCliLoginService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.shutdown()));
  vi.useRealTimers();
  if (directory)
    await filesystem.rm(directory, { recursive: true, force: true });
});

function fakeLogin(provider: "codex_cli" | "claude_code") {
  const finish = vi.fn<(result: CliProcessResult) => void>();
  const completed = new Promise<CliProcessResult>((resolve) => {
    finish.mockImplementation(resolve);
  });
  const process: CliRunningProcess = {
    completed,
    write: vi.fn().mockReturnValue(true),
    cancel: vi.fn((code) => {
      finish({ ...RESULT, errorCode: code });
    }),
  };
  const adapter: CliToolAdapter = {
    provider,
    version: vi
      .fn()
      .mockResolvedValue({ ok: true, detail: { cliVersion: "1.2.3" } }),
    readStatus: vi.fn().mockResolvedValue({
      outcome: {
        ok: true,
        detail: {
          authMethod: provider === "codex_cli" ? "chatgpt" : "claude.ai",
        },
      },
      accountLabel: "admin@example.test",
    }),
    startLogin: vi.fn((_, onChallenge) => {
      onChallenge({
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-EFGH",
      });
      return process;
    }),
    loginError: vi.fn((result) => result.errorCode ?? "login_failed"),
    runTest: vi.fn(),
    listModels: vi.fn(),
    logout: vi.fn(),
  };
  return { adapter, process, finish };
}

describe("admin CLI login service", () => {
  const getDatabase = useMigratedDatabase();
  async function setup(provider: "codex_cli" | "claude_code" = "codex_cli") {
    directory = await filesystem.mkdtemp(
      path.join(tmpdir(), "pages-login-test-"),
    );
    const repository = new AgentConnectionRepository(getDatabase());
    const store = new AgentCredentialStore(directory);
    const locator = new CliLocator("/not-installed", "/not-installed/node");
    vi.spyOn(locator, "find").mockResolvedValue(locations[provider]);
    vi.spyOn(locator, "list").mockResolvedValue(locations);
    const runner = new CliProcessRunner(createCliSpawn());
    const runtime = new AgentCliRuntime({ store, locator, runner });
    const operations = new AgentOperationRegistry();
    const login = fakeLogin(provider);
    vi.spyOn(runtime, "adapter").mockResolvedValue(login.adapter);
    vi.spyOn(runtime, "cleanup").mockResolvedValue(undefined);
    const catalog = { loadAfterAccess: vi.fn().mockResolvedValue(undefined) };
    const service = new AgentCliLoginService({
      repository,
      store,
      locator,
      runner,
      runtime,
      operations,
      catalog,
    });
    services.push(service);
    async function insert(id = ID, chosenProvider: AgentProviderId = provider) {
      await repository.insert({
        id,
        name: id,
        provider: chosenProvider,
        secretEncrypted: chosenProvider === "openai" ? "cipher" : null,
        testModel: null,
        actorId: ADMIN.userId,
      });
      const record = await repository.find(id);
      if (!record) throw new Error("missing fixture");
      return record;
    }
    const record = await insert();
    async function awaiting(id = ID) {
      await vi.waitFor(async () =>
        expect((await service.read(ADMIN, id))?.state).toBe("awaiting_user"),
      );
    }
    async function state(expected: string, id = ID) {
      await vi.waitFor(async () =>
        expect((await service.read(ADMIN, id))?.state).toBe(expected),
      );
    }
    return {
      repository,
      store,
      locator,
      runner,
      runtime,
      operations,
      catalog,
      service,
      insert,
      record,
      awaiting,
      state,
      ...login,
    };
  }

  it("checks every public actor method before lookup or process work", async () => {
    const { service, record, adapter } = await setup();
    for (const actor of [
      createAccess(),
      createAccess({ isAdmin: true }),
      createAccess({ isAdmin: true, mode: "admin", isActive: false }),
    ]) {
      for (const operation of [
        () => service.tools(actor),
        () => service.describe(actor, record),
        () => service.start(actor, ID),
        () => service.read(actor, ID),
        () => service.submitCode(actor, ID, "code"),
        () => service.cancel(actor, ID),
        () => service.logout(actor, ID),
        () => service.cleanup(actor, record),
      ])
        await expect(operation()).rejects.toBeInstanceOf(
          AgentAccessDeniedError,
        );
    }
    expect(adapter.startLogin).not.toHaveBeenCalled();
  });

  it("loads only filesystem metadata and protects device codes from general summaries", async () => {
    const { service, record, store, adapter, awaiting, finish, state } =
      await setup();
    const prepare = vi.spyOn(store, "prepare");
    expect(await service.tools(ADMIN)).toEqual(locations);
    expect(await service.describe(ADMIN, record)).toMatchObject({
      binaryFound: true,
      loggedInAt: null,
      login: null,
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(adapter.version).not.toHaveBeenCalled();
    expect(await service.read(ADMIN, ID)).toBeNull();
    expect(await service.start(ADMIN, ID)).toMatchObject({ state: "starting" });
    await awaiting();
    expect(await service.read(ADMIN, ID)).toMatchObject({
      state: "awaiting_user",
      userCode: "ABCD-EFGH",
    });
    expect(JSON.stringify(await service.describe(ADMIN, record))).not.toContain(
      "ABCD-EFGH",
    );
    finish(RESULT);
    await state("succeeded");
    expect(JSON.stringify(await service.read(ADMIN, ID))).not.toContain(
      "ABCD-EFGH",
    );
  });

  it("sets persistent account metadata only after successful status and clears both old checks", async () => {
    const { service, repository, awaiting, finish, state, adapter, catalog } =
      await setup("claude_code");
    // The model list loads after the sign-in is stored, while the session still verifies.
    let duringLoad: unknown[] = [];
    catalog.loadAfterAccess.mockImplementationOnce(async () => {
      duringLoad = [
        (await service.read(ADMIN, ID))?.state,
        Boolean((await repository.find(ID))?.cliLoggedInAt),
      ];
    });
    const passed = {
      status: "passed",
      errorCode: null,
      checkedAt: "now",
      durationMs: 1,
      detail: {},
    } as const;
    await repository.checks().save(ID, "auth", passed, "admin");
    await repository.checks().save(ID, "model", passed, "admin");
    await service.start(ADMIN, ID);
    await awaiting();
    expect((await repository.find(ID))?.cliLoggedInAt).toBeNull();
    expect(await repository.checks().find(ID, "auth")).toBeNull();
    finish(RESULT);
    await state("succeeded");
    expect(adapter.readStatus).toHaveBeenCalled();
    expect(await repository.find(ID)).toMatchObject({
      cliLoggedInAt: expect.stringMatching(/Z$/),
      cliAccountLabel: "admin@example.test",
    });
    expect(await repository.checks().find(ID, "model")).toBeNull();
    expect(catalog.loadAfterAccess).toHaveBeenCalledExactlyOnceWith(ID);
    expect(duringLoad).toEqual(["verifying", true]);
  });

  it("rejects code inputs, forwards a Claude code once, and hides the challenge during verification", async () => {
    const { service, process, awaiting, finish, state } =
      await setup("claude_code");
    await service.start(ADMIN, ID);
    await awaiting();
    for (const code of ["", "   ", "x".repeat(513), "code\n", "code\u0000"])
      await expect(service.submitCode(ADMIN, ID, code)).rejects.toMatchObject({
        code: "login_code_invalid",
      });
    await service.submitCode(ADMIN, ID, "synthetic-code");
    expect(process.write).toHaveBeenCalledWith("synthetic-code");
    expect(await service.read(ADMIN, ID)).toMatchObject({ state: "verifying" });
    expect(JSON.stringify(await service.read(ADMIN, ID))).not.toMatch(
      /ABCD-EFGH|synthetic-code|verificationUrl/,
    );
    await expect(service.submitCode(ADMIN, ID, "again")).rejects.toMatchObject({
      code: "login_not_running",
    });
    finish({ ...RESULT, exitCode: 1 });
    await state("failed");
  });

  it("rejects codes without the correct live pipe and permits cancellation to release the connection", async () => {
    const { service, process, awaiting, state, operations } = await setup();
    await expect(service.cancel(ADMIN, ID)).rejects.toMatchObject({
      code: "login_not_running",
    });
    await expect(service.submitCode(ADMIN, ID, "code")).rejects.toMatchObject({
      code: "login_not_running",
    });
    await service.start(ADMIN, ID);
    await awaiting();
    await expect(service.submitCode(ADMIN, ID, "code")).rejects.toMatchObject({
      code: "login_not_running",
    });
    await service.cancel(ADMIN, ID);
    expect(process.cancel).toHaveBeenCalledWith("login_cancelled");
    await state("cancelled");
    const release = operations.acquire(ID, "check");
    release();
    await expect(service.cancel(ADMIN, ID)).rejects.toMatchObject({
      code: "login_not_running",
    });
  });

  it("rejects a failed Claude stdin write without echoing its code", async () => {
    const { service, process, awaiting } = await setup("claude_code");
    await service.start(ADMIN, ID);
    await awaiting();
    vi.mocked(process.write).mockReturnValue(false);
    await expect(
      service.submitCode(ADMIN, ID, "synthetic-code"),
    ).rejects.toMatchObject({ code: "login_not_running" });
    await service.cancel(ADMIN, ID);
  });

  it("limits active sessions globally and per connection, and terminates them at shutdown", async () => {
    const { service, insert, awaiting, process } = await setup();
    await service.start(ADMIN, ID);
    await awaiting();
    await expect(service.start(ADMIN, ID)).rejects.toMatchObject({
      code: "login_in_progress",
    });
    for (const suffix of ["2", "3"]) {
      const id = ID.slice(0, -1) + suffix;
      await insert(id);
      await service.start(ADMIN, id);
      await awaiting(id);
    }
    const fourth = ID.slice(0, -1) + "4";
    await insert(fourth);
    await expect(service.start(ADMIN, fourth)).rejects.toMatchObject({
      code: "login_limit_reached",
    });
    await service.shutdown();
    expect(process.cancel).toHaveBeenCalledTimes(3);
    expect(await service.read(ADMIN, ID)).toBeNull();
    await expect(service.start(ADMIN, ID)).rejects.toMatchObject({
      code: "login_limit_reached",
    });
  });

  it.each(["codex_cli", "claude_code"] as const)(
    "expires %s sessions and discards terminal states after five minutes",
    async (provider) => {
      const { service, awaiting, state } = await setup(provider);
      vi.useFakeTimers();
      await service.start(ADMIN, ID);
      await awaiting();
      await vi.advanceTimersByTimeAsync(
        provider === "codex_cli" ? 930_000 : 600_000,
      );
      await state("expired");
      expect(await service.read(ADMIN, ID)).toMatchObject({
        errorCode: "login_expired",
      });
      await vi.advanceTimersByTimeAsync(300_000);
      expect(await service.read(ADMIN, ID)).toBeNull();
    },
  );

  it("reports known and unexpected login errors without saving account success", async () => {
    const { service, adapter, awaiting, finish, state, repository, catalog } =
      await setup();
    vi.mocked(adapter.readStatus).mockResolvedValue({
      outcome: { ok: false, errorCode: "cli_not_logged_in", detail: {} },
      accountLabel: null,
    });
    await service.start(ADMIN, ID);
    await awaiting();
    finish(RESULT);
    await state("failed");
    expect(await service.read(ADMIN, ID)).toMatchObject({
      errorCode: "cli_not_logged_in",
    });
    expect((await repository.find(ID))?.cliLoggedInAt).toBeNull();
    vi.mocked(adapter.version).mockRejectedValueOnce(
      new Error("private raw error"),
    );
    await service.start(ADMIN, ID);
    await state("failed");
    expect(await service.read(ADMIN, ID)).toMatchObject({
      errorCode: "login_failed",
    });
    vi.mocked(adapter.version).mockResolvedValueOnce({
      ok: false,
      errorCode: "cli_not_executable",
      detail: {},
    });
    await service.start(ADMIN, ID);
    await state("failed");
    expect(await service.read(ADMIN, ID)).toMatchObject({
      errorCode: "cli_not_executable",
    });
    expect(catalog.loadAfterAccess).not.toHaveBeenCalled();
  });

  it("handles failed login exit and provider-reported failure codes", async () => {
    const { service, adapter, awaiting, finish, state } = await setup();
    vi.mocked(adapter.loginError).mockReturnValue("login_code_rejected");
    await service.start(ADMIN, ID);
    await awaiting();
    finish({ ...RESULT, exitCode: 1, errorCode: "login_code_rejected" });
    await state("failed");
    expect(await service.read(ADMIN, ID)).toMatchObject({
      errorCode: "login_code_rejected",
    });
  });

  it("cancels preparation before a CLI login can start", async () => {
    const { service, adapter, state, repository } = await setup();
    const finishVersion = vi.fn<(outcome: ProviderCheckOutcome) => void>();
    vi.mocked(adapter.version).mockReturnValueOnce(
      new Promise((resolve) => {
        finishVersion.mockImplementation(resolve);
      }),
    );
    await service.start(ADMIN, ID);
    await vi.waitFor(() => expect(adapter.version).toHaveBeenCalled());
    const cancellation = service.cancel(ADMIN, ID);
    await vi.waitFor(async () => {
      const view = await service.read(ADMIN, ID);
      expect(view?.errorCode).toBe("login_cancelled");
    });
    finishVersion({ ok: true, detail: {} });
    await cancellation;
    await state("cancelled");
    expect(adapter.startLogin).not.toHaveBeenCalled();
    expect((await repository.find(ID))?.cliLoggedInAt).toBeNull();
  });

  it("cleans up credentials before clearing metadata and removes retained session views", async () => {
    const { service, runtime, record, repository, awaiting, finish, state } =
      await setup();
    await service.start(ADMIN, ID);
    await awaiting();
    finish(RESULT);
    await state("succeeded");
    vi.mocked(runtime.cleanup).mockRejectedValueOnce(
      new AgentError("credential_cleanup_failed"),
    );
    await expect(service.logout(ADMIN, ID)).rejects.toMatchObject({
      code: "credential_cleanup_failed",
    });
    expect((await repository.find(ID))?.cliLoggedInAt).not.toBeNull();
    await service.logout(ADMIN, ID);
    expect((await repository.find(ID))?.cliLoggedInAt).toBeNull();
    expect(await service.read(ADMIN, ID)).toBeNull();
    await service.cleanup(ADMIN, record);
    expect(runtime.cleanup).toHaveBeenCalledTimes(3);
  });

  it("rejects missing/API connections, reports missing binaries and uses isolated fallback commands", async () => {
    const { service, insert, runtime, locator, record } = await setup();
    const api = await insert(ID.slice(0, -1) + "2", "openai");
    await expect(service.start(ADMIN, api.id)).rejects.toMatchObject({
      code: "provider_invalid",
    });
    await expect(service.describe(ADMIN, api)).rejects.toMatchObject({
      code: "provider_invalid",
    });
    await expect(service.start(ADMIN, "missing")).rejects.toMatchObject({
      code: "connection_not_found",
    });
    vi.mocked(runtime.adapter).mockRejectedValueOnce(
      new AgentError("cli_not_found"),
    );
    await expect(service.start(ADMIN, ID)).rejects.toMatchObject({
      code: "cli_not_found",
    });
    vi.mocked(locator.find).mockResolvedValue({ found: false, path: null });
    expect(await service.describe(ADMIN, record)).toMatchObject({
      binaryFound: false,
      terminalCommand: expect.stringContaining("'codex'"),
    });
    expect(
      await service.describe(ADMIN, { ...record, provider: "claude_code" }),
    ).toMatchObject({ terminalCommand: expect.stringContaining("'claude'") });
  });

  it.each(["status", "secure", "save"] as const)(
    "cancels a late success during %s without retaining account metadata",
    async (stage) => {
      const { service, adapter, store, repository, awaiting, finish, state } =
        await setup();
      const release = vi.fn<() => void>();
      const gate = new Promise<void>((resolve) => {
        release.mockImplementation(resolve);
      });
      let hasReachedStage = false;
      if (stage === "status")
        vi.mocked(adapter.readStatus).mockImplementationOnce(async () => {
          hasReachedStage = true;
          await gate;
          return { outcome: { ok: true, detail: {} }, accountLabel: null };
        });
      if (stage === "secure")
        vi.spyOn(store, "secure").mockImplementationOnce(async () => {
          hasReachedStage = true;
          await gate;
        });
      if (stage === "save") {
        const save = repository.setCliAccount.bind(repository);
        vi.spyOn(repository, "setCliAccount").mockImplementation(
          async (...args) => {
            await save(...args);
            if (args[1].loggedInAt !== null) {
              hasReachedStage = true;
              await gate;
            }
          },
        );
      }
      await service.start(ADMIN, ID);
      await awaiting();
      finish(RESULT);
      await vi.waitFor(() => expect(hasReachedStage).toBe(true));
      const cancellation = service.cancel(ADMIN, ID);
      await vi.waitFor(async () =>
        expect((await service.read(ADMIN, ID))?.errorCode).toBe(
          "login_cancelled",
        ),
      );
      release();
      await cancellation;
      await state("cancelled");
      expect((await repository.find(ID))?.cliLoggedInAt).toBeNull();
    },
  );

  it("releases a completed session once and can clear timers without an expiry timer", async () => {
    const { adapter, store } = await setup();
    const registry = new CliLoginSessionRegistry();
    const session: CliLoginSession = {
      id: ID,
      provider: "codex_cli",
      adapter,
      home: store.paths(ID, "codex_cli"),
      expiresAt: "later",
      release: vi.fn(),
      controller: new AbortController(),
      state: "starting",
      process: null,
      task: null,
      expiry: null,
    };
    registry.add(session);
    registry.finish(session, "succeeded");
    registry.finish(session, "failed", "login_failed");
    expect(session.release).toHaveBeenCalledTimes(1);
    expect(registry.view(ID)).toMatchObject({ state: "succeeded" });
    registry.clear();
    expect(registry.view(ID)).toBeNull();
  });

  it("rejects a start racing with shutdown during CLI discovery", async () => {
    const { service, runtime, adapter } = await setup();
    const resolve = vi.fn<(tool: CliToolAdapter) => void>();
    vi.mocked(runtime.adapter).mockReturnValueOnce(
      new Promise((complete) => {
        resolve.mockImplementation(complete);
      }),
    );
    const starting = service.start(ADMIN, ID);
    await vi.waitFor(() => expect(runtime.adapter).toHaveBeenCalled());
    await service.shutdown();
    const rejected = expect(starting).rejects.toMatchObject({
      code: "login_limit_reached",
    });
    resolve(adapter);
    await rejected;
  });
});
