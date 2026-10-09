import { describe, expect, it, vi } from "vitest";

import { CatalogProviderClient } from "@/backend/agents/catalog/CatalogProviderClient";
import { createApiProviderRegistry } from "@/backend/agents/providers/ApiProviderRegistry";
import { ProviderHttpClient } from "@/backend/agents/providers/ProviderHttpClient";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentCatalogRefresh } from "@/backend/service/agents/AgentCatalogRefresh";
import { AgentCheckService } from "@/backend/service/agents/AgentCheckService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";

import { createCatalogModel } from "../helpers/agents";
import { createAccess } from "../helpers/authorization";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AgentConnectionWrite } from "@/backend/database/repositories/AgentConnectionRepository";
import type {
  ProviderHttpTransport,
  ProviderCheckOutcome,
} from "@/backend/agents/providers/ProviderContracts";

const ADMIN = createAccess({ isAdmin: true, mode: "admin" });

describe("agent check execution", () => {
  const getDatabase = useMigratedDatabase();
  async function setup(overrides: Partial<AgentConnectionWrite> = {}) {
    const repository = new AgentConnectionRepository(getDatabase());
    const cipher = new InstanceSecretCipher(Buffer.alloc(32, 5));
    const operations = new AgentOperationRegistry();
    await repository.insert({
      id: "one",
      name: "Test",
      provider: "openai",
      secretEncrypted: cipher.encrypt("one", "fake-key-marker"),
      testModel: "test-model",
      actorId: "admin",
      ...overrides,
    });
    const request = vi
      .fn<ProviderHttpTransport>()
      .mockResolvedValue({ status: 200, json: async () => ({ data: [] }) });
    const providers = createApiProviderRegistry(
      new ProviderHttpClient(request),
    );
    const cli = {
      check: vi
        .fn()
        .mockResolvedValue({ ok: true, detail: { authMethod: "chatgpt" } }),
    };
    const timeout = vi.fn(AbortSignal.timeout);
    const catalog = { loadAfterAccess: vi.fn().mockResolvedValue(undefined) };
    return {
      repository,
      cipher,
      operations,
      request,
      providers,
      cli,
      timeout,
      catalog,
      service: new AgentCheckService({
        repository,
        catalog,
        cipher,
        operations,
        providers,
        cli,
        timeout,
      }),
    };
  }

  it("rejects unauthorized actors and missing connections before contacting a provider", async () => {
    const { service, request } = await setup();
    for (const actor of [
      createAccess(),
      createAccess({ isAdmin: true }),
      createAccess({ isAdmin: true, mode: "admin", isActive: false }),
    ]) {
      await expect(service.run(actor, "one", "auth")).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
    }
    await expect(service.run(ADMIN, "missing", "auth")).rejects.toMatchObject({
      code: "connection_not_found",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("persists success and failure with actor, scope, duration and timestamp", async () => {
    const { service, request, repository, timeout } = await setup();
    const passed = await service.run(ADMIN, "one", "auth");
    expect(passed).toMatchObject({
      status: "passed",
      errorCode: null,
      detail: { modelCount: 0 },
    });
    expect(passed.durationMs).toBeGreaterThanOrEqual(0);
    expect(passed.checkedAt).toMatch(/Z$/);
    expect(await repository.checks().find("one", "auth")).toEqual(passed);
    request.mockResolvedValueOnce({
      status: 401,
      json: async () => ({ error: { message: "fake-key-marker" } }),
    });
    const failed = await service.run(ADMIN, "one", "model");
    expect(failed).toMatchObject({
      status: "failed",
      errorCode: "provider_auth_failed",
    });
    expect(await repository.checks().find("one", "model")).toEqual(failed);
    expect(JSON.stringify([passed, failed])).not.toContain("fake-key-marker");
    expect(timeout.mock.calls).toEqual([[15_000], [30_000]]);
    expect(
      await getDatabase().query(
        "SELECT checked_by FROM agent_connection_checks;",
      ),
    ).toEqual([[ADMIN.userId], [ADMIN.userId]]);
  });

  it("sends the saved reasoning effort with the model test and records it", async () => {
    const { service, repository, providers } = await setup({
      provider: "openrouter",
    });
    await repository.update("one", {
      name: "Test",
      secretEncrypted: null,
      testModel: "test-model",
      reasoningEffort: "high",
      clearModel: true,
      actorId: "admin",
    });
    const modelTest = vi
      .spyOn(providers.openrouter, "runModelTest")
      .mockResolvedValue({ ok: true, detail: { model: "test-model" } });
    vi.spyOn(providers.openrouter, "checkAccess").mockResolvedValue({
      ok: true,
      detail: {},
    });
    expect(await service.run(ADMIN, "one", "model")).toMatchObject({
      status: "passed",
      detail: { model: "test-model", reasoningEffort: "high" },
    });
    expect(modelTest).toHaveBeenCalledWith(
      {
        apiKey: "fake-key-marker",
        model: "test-model",
        reasoningEffort: "high",
      },
      expect.any(AbortSignal),
    );
    // The access check involves no model, so it records no effort.
    expect((await service.run(ADMIN, "one", "auth")).detail).toEqual({});
  });

  it("loads the model list only after a passed access check", async () => {
    const { service, request, catalog } = await setup();
    await service.run(ADMIN, "one", "auth");
    expect(catalog.loadAfterAccess).toHaveBeenCalledExactlyOnceWith("one");
    request.mockResolvedValueOnce({ status: 401, json: async () => ({}) });
    await service.run(ADMIN, "one", "auth");
    await service.run(ADMIN, "one", "model");
    expect(catalog.loadAfterAccess).toHaveBeenCalledOnce();
  });

  it("stores a listed default model when an access check unlocks a connection without one", async () => {
    const { repository, cipher, operations, providers, cli } = await setup({
      provider: "openrouter",
      testModel: null,
    });
    const client = new CatalogProviderClient();
    vi.spyOn(client, "list").mockResolvedValue([
      createCatalogModel({ id: "vendor/paid" }),
      createCatalogModel({ id: "openrouter/free", isFree: true }),
    ]);
    const refresh = new AgentCatalogRefresh({
      repository,
      cipher,
      operations,
      client,
      cli: { listModels: vi.fn() },
    });
    vi.spyOn(providers.openrouter, "checkAccess").mockResolvedValue({
      ok: true,
      detail: {},
    });
    const service = new AgentCheckService({
      repository,
      catalog: refresh,
      cipher,
      operations,
      providers,
      cli,
    });
    const check = await service.run(ADMIN, "one", "auth");
    expect((await repository.find("one"))?.testModel).toBe("openrouter/free");
    const catalog = await repository.catalogs().find("one");
    expect(catalog.models).toHaveLength(2);
    // Listed after the check, so the panel does not load it again.
    expect(Date.parse(catalog.attemptedAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse(check.checkedAt),
    );
  });

  it("requires an API test model even before decrypting a secret", async () => {
    const { service, request } = await setup({
      testModel: null,
      secretEncrypted: "invalid",
    });
    await expect(service.run(ADMIN, "one", "model")).rejects.toMatchObject({
      code: "test_model_required",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("records missing or undecryptable secrets safely", async () => {
    const { service, repository, request } = await setup({
      secretEncrypted: "invalid",
    });
    expect(await service.run(ADMIN, "one", "auth")).toMatchObject({
      status: "failed",
      errorCode: "secret_unavailable",
    });
    vi.spyOn(repository, "findSecretEncrypted").mockResolvedValueOnce(null);
    expect(await service.run(ADMIN, "one", "auth")).toMatchObject({
      errorCode: "secret_unavailable",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("holds one shared connection lock and releases it after transport and persistence failures", async () => {
    const { service, providers, repository } = await setup();
    let complete: (outcome: ProviderCheckOutcome) => void = () => undefined;
    const pending = new Promise<ProviderCheckOutcome>((resolve) => {
      complete = resolve;
    });
    vi.spyOn(providers.openai, "checkAccess").mockReturnValueOnce(pending);
    const first = service.run(ADMIN, "one", "auth");
    await expect(service.run(ADMIN, "one", "model")).rejects.toMatchObject({
      code: "check_in_progress",
    });
    complete({ ok: true, detail: {} });
    await first;
    vi.spyOn(repository.checks(), "save").mockRejectedValueOnce(
      new Error("disk error"),
    );
    await expect(service.run(ADMIN, "one", "auth")).rejects.toThrow(
      "disk error",
    );
    expect(await service.run(ADMIN, "one", "auth")).toMatchObject({
      status: "passed",
    });
  });

  it("strips extra adapter fields before persistence and uses the default timeout factory", async () => {
    const dependencies = await setup();
    const service = new AgentCheckService(dependencies);
    const detail = { inputTokens: 2, secret: "marker", rawOutput: "private" };
    vi.spyOn(
      dependencies.providers.openai,
      "checkAccess",
    ).mockResolvedValueOnce({ ok: true, detail });
    expect((await service.run(ADMIN, "one", "auth")).detail).toEqual({
      inputTokens: 2,
    });
    const { repository, catalog, cipher, operations, providers, cli } =
      dependencies;
    expect(
      await new AgentCheckService({
        repository,
        catalog,
        cipher,
        operations,
        providers,
        cli,
      }).run(ADMIN, "one", "auth"),
    ).toMatchObject({ status: "passed" });
  });

  it("tracks explicit CLI status checks, supports default CLI models and clears stale account state", async () => {
    const { service, repository, cli, timeout } = await setup({
      provider: "codex_cli",
      secretEncrypted: null,
      testModel: null,
    });
    const passed = await service.run(ADMIN, "one", "auth");
    expect(await repository.find("one")).toMatchObject({
      cliLoggedInAt: passed.checkedAt,
    });
    await service.run(ADMIN, "one", "model");
    expect(timeout.mock.calls).toEqual([[25_000], [45_000]]);
    cli.check.mockResolvedValueOnce({
      ok: false,
      errorCode: "cli_check_failed",
      detail: {},
    });
    await service.run(ADMIN, "one", "model");
    expect((await repository.find("one"))?.cliLoggedInAt).not.toBeNull();
    for (const errorCode of ["cli_auth_failed", "cli_not_logged_in"]) {
      cli.check.mockResolvedValueOnce({ ok: false, errorCode, detail: {} });
      expect(await service.run(ADMIN, "one", "auth")).toMatchObject({
        errorCode,
      });
      expect((await repository.find("one"))?.cliLoggedInAt).toBeNull();
      expect(await repository.checks().find("one", "model")).toBeNull();
    }
  });
});
