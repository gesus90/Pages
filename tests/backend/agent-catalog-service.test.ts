import { describe, expect, it, vi } from "vitest";

import { CatalogProviderClient } from "@/backend/agents/catalog/CatalogProviderClient";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AgentCatalogRepository } from "@/backend/database/repositories/agent/AgentCatalogRepository";
import {
  AgentError,
  AgentAccessDeniedError,
} from "@/backend/error/AgentErrors";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentCatalogRefresh } from "@/backend/service/agents/AgentCatalogRefresh";
import { AgentCatalogService } from "@/backend/service/agents/AgentCatalogService";
import { AgentCatalogScheduler } from "@/backend/service/agents/AgentCatalogScheduler";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";

import { createCatalogModel } from "../helpers/agents";
import { createAccess } from "../helpers/authorization";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AgentConnectionWrite } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

const ADMIN = createAccess({ isAdmin: true, mode: "admin" });
const MODEL: AgentCatalogModel = createCatalogModel({
  id: "test",
  name: "Test",
  contextWindow: 1000,
  promptPrice: "0",
  completionPrice: "0",
  isFree: true,
});

describe("admin catalogs, persistence and scheduling", () => {
  const getDatabase = useMigratedDatabase();
  async function setup(overrides: Partial<AgentConnectionWrite> = {}) {
    const repository = new AgentConnectionRepository(getDatabase());
    const cipher = new InstanceSecretCipher(Buffer.alloc(32, 9));
    const operations = new AgentOperationRegistry();
    const client = new CatalogProviderClient();
    const list = vi.spyOn(client, "list").mockResolvedValue([MODEL]);
    await repository.insert({
      id: "one",
      name: "First",
      provider: "openrouter",
      testModel: "unknown-model",
      secretEncrypted: cipher.encrypt(
        overrides.id ?? "one",
        "synthetic-secret",
      ),
      actorId: ADMIN.userId,
      ...overrides,
    });
    const cli = { listModels: vi.fn().mockResolvedValue([MODEL]) };
    const refresh = new AgentCatalogRefresh({
      repository,
      cipher,
      client,
      cli,
      operations,
    });
    const service = new AgentCatalogService(repository, refresh, operations);
    const scheduler = new AgentCatalogScheduler(repository.catalogs(), refresh);
    return {
      repository,
      cipher,
      operations,
      client,
      cli,
      list,
      refresh,
      service,
      scheduler,
    };
  }

  it("requires active admin mode for all reads, cadence changes and refreshes before touching a provider", async () => {
    const { service, list } = await setup();
    for (const actor of [
      createAccess(),
      createAccess({ isAdmin: true }),
      createAccess({ isAdmin: true, mode: "admin", isActive: false }),
    ]) {
      await expect(service.list(actor)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
      await expect(service.configure(actor, "one", 24)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
      await expect(service.run(actor, "one")).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
    }
    expect(list).not.toHaveBeenCalled();
    expect(await service.list(ADMIN)).toEqual({ one: emptyModelCatalog() });
    expect(list).not.toHaveBeenCalled();
    await expect(service.run(ADMIN, "missing")).rejects.toMatchObject({
      code: "connection_not_found",
    });
    await expect(service.configure(ADMIN, "missing", 24)).rejects.toMatchObject(
      { code: "connection_not_found" },
    );
    for (const interval of [-1, 1, 12, NaN, Infinity])
      await expect(
        service.configure(ADMIN, "one", interval),
      ).rejects.toMatchObject({ code: "catalog_interval_invalid" });
  });

  it("preserves manual model IDs for Z.AI, which has no catalog", async () => {
    const { service, list, cli } = await setup({
      provider: "zai",
      secretEncrypted: "encrypted",
    });
    expect(await service.list(ADMIN)).toEqual({});
    await expect(service.run(ADMIN, "one")).rejects.toMatchObject({
      code: "catalog_unsupported",
    });
    await expect(service.configure(ADMIN, "one", 6)).rejects.toMatchObject({
      code: "catalog_unsupported",
    });
    expect(list).not.toHaveBeenCalled();
    expect(cli.listModels).not.toHaveBeenCalled();
  });

  it.each(["codex_cli", "claude_code"] as const)(
    "lists the models of the signed-in %s without decrypting anything",
    async (provider) => {
      const { service, list, cli, cipher } = await setup({
        provider,
        secretEncrypted: null,
      });
      const decrypt = vi.spyOn(cipher, "decrypt");
      const levels = createCatalogModel({
        id: "vendor-large",
        reasoning: "levels",
        reasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "low",
      });
      cli.listModels.mockResolvedValueOnce([levels, MODEL]);
      expect(await service.list(ADMIN)).toEqual({ one: emptyModelCatalog() });
      // Reasoning levels survive the stored snapshot unchanged.
      expect(await service.run(ADMIN, "one")).toMatchObject({
        models: [levels, MODEL],
        errorCode: null,
      });
      expect(cli.listModels).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: "one", provider }),
        expect.any(AbortSignal),
      );
      cli.listModels.mockRejectedValueOnce(new AgentError("cli_not_logged_in"));
      expect(await service.run(ADMIN, "one")).toMatchObject({
        models: [levels, MODEL],
        errorCode: "cli_not_logged_in",
      });
      expect(list).not.toHaveBeenCalled();
      expect(decrypt).not.toHaveBeenCalled();
    },
  );

  it("stores a listed default only for a connection without a model and keeps any saved choice", async () => {
    const { service, repository, list, cli } = await setup({ testModel: null });
    const router = createCatalogModel({ id: "openrouter/free", isFree: true });
    list.mockResolvedValue([MODEL, router]);
    await repository.checks().save(
      "one",
      "model",
      {
        status: "passed",
        errorCode: null,
        checkedAt: "2026-10-08T10:00:00.000Z",
        durationMs: 1,
        detail: {},
      },
      ADMIN.userId,
    );
    list.mockRejectedValueOnce(new AgentError("provider_unavailable"));
    await service.run(ADMIN, "one");
    // A failed listing chooses nothing.
    expect((await repository.find("one"))?.testModel).toBeNull();
    await service.run(ADMIN, "one");
    expect(await repository.find("one")).toMatchObject({
      testModel: "openrouter/free",
      reasoningEffort: null,
    });
    // The previous check does not apply to the new model.
    expect(await repository.checks().find("one", "model")).toBeNull();
    // Later refreshes and a model saved meanwhile stay untouched.
    list.mockResolvedValue([MODEL]);
    await service.run(ADMIN, "one");
    expect((await repository.find("one"))?.testModel).toBe("openrouter/free");
    expect(await repository.assignDefaultModel("one", "test")).toBe(false);
    expect((await repository.find("one"))?.testModel).toBe("openrouter/free");
    expect(cli.listModels).not.toHaveBeenCalled();
  });

  it("loads after a confirmed access without failing it, but surfaces programming errors", async () => {
    const { refresh, repository, list } = await setup({ testModel: null });
    await refresh.loadAfterAccess("one");
    expect((await repository.find("one"))?.testModel).toBe("test");
    expect(list).toHaveBeenCalledOnce();
    // A provider without a catalog or a vanished connection is skipped quietly.
    await expect(refresh.loadAfterAccess("missing")).resolves.toBeUndefined();
    vi.spyOn(repository, "find").mockRejectedValueOnce(new Error("disk error"));
    await expect(refresh.loadAfterAccess("one")).rejects.toThrow("disk error");
  });

  it("leaves the choice to the administrator when the provider marks no default", async () => {
    const { service, repository, list } = await setup({
      provider: "openai",
      testModel: null,
    });
    list.mockResolvedValue([MODEL]);
    await service.run(ADMIN, "one");
    expect((await repository.find("one"))?.testModel).toBeNull();
  });

  it("persists complete snapshots and both timestamps; failures retain the last successful entries and selected unknown ID", async () => {
    const { service, repository, list } = await setup();
    const good = await service.run(ADMIN, "one");
    expect(good).toMatchObject({
      models: [MODEL],
      intervalHours: 0,
      nextRefreshAt: null,
      errorCode: null,
    });
    expect(good.attemptedAt).toBe(good.refreshedAt);
    expect((await repository.find("one"))?.testModel).toBe("unknown-model");
    expect(await repository.checks().find("one", "auth")).toBeNull();
    expect(await repository.checks().find("one", "model")).toBeNull();
    list.mockRejectedValueOnce(new AgentError("provider_rate_limited"));
    const failed = await service.run(ADMIN, "one");
    expect(failed).toMatchObject({
      models: [MODEL],
      errorCode: "provider_rate_limited",
      refreshedAt: good.refreshedAt,
    });
    expect(await new AgentCatalogRepository(getDatabase()).find("one")).toEqual(
      failed,
    );
    list.mockRejectedValueOnce(new Error("raw-provider-secret"));
    expect(await service.run(ADMIN, "one")).toMatchObject({
      models: [MODEL],
      errorCode: "provider_unreachable",
    });
    expect(JSON.stringify(await service.list(ADMIN))).not.toContain(
      "raw-provider-secret",
    );
    list.mockResolvedValueOnce([]);
    expect(await service.run(ADMIN, "one")).toMatchObject({
      models: [],
      errorCode: null,
    });
  });

  it("reanchors interval changes, survives a new scheduler and disables scheduled work in manual-only mode", async () => {
    const now = new Date("2026-10-08T15:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    const { service, repository, list, refresh, scheduler } = await setup();
    await service.configure(ADMIN, "one", 6);
    expect(await repository.catalogs().find("one")).toMatchObject({
      intervalHours: 6,
      nextRefreshAt: "2026-10-08T21:00:00.000Z",
    });
    expect(await repository.catalogs().nextDue(now.toISOString())).toBeNull();
    await service.configure(ADMIN, "one", 168);
    expect(await repository.catalogs().find("one")).toMatchObject({
      nextRefreshAt: "2026-10-15T15:00:00.000Z",
    });
    await service.configure(ADMIN, "one", 24);
    const catalog = await service.run(ADMIN, "one");
    expect(catalog.nextRefreshAt).toBe("2026-10-09T15:00:00.000Z");
    await repository
      .catalogs()
      .configure("one", 24, "2000-01-01T00:00:00.000Z");
    const restarted = new AgentCatalogScheduler(
      new AgentCatalogRepository(getDatabase()),
      refresh,
    );
    await restarted.runOnce();
    expect(list).toHaveBeenCalledTimes(2);
    expect((await repository.catalogs().find("one")).nextRefreshAt).toBe(
      "2026-10-09T15:00:00.000Z",
    );
    await service.configure(ADMIN, "one", 0);
    await scheduler.runOnce();
    expect(list).toHaveBeenCalledTimes(2);
    expect((await service.list(ADMIN)).one.nextRefreshAt).toBeNull();
  });

  it("shares the connection operation lock, disallows simultaneous refresh/configure/check writes and releases after persistence errors", async () => {
    const { service, repository, operations, list } = await setup();
    let complete: (models: readonly AgentCatalogModel[]) => void = () =>
      undefined;
    list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const first = service.run(ADMIN, "one");
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
    await expect(service.run(ADMIN, "one")).rejects.toMatchObject({
      code: "check_in_progress",
    });
    await expect(service.configure(ADMIN, "one", 6)).rejects.toMatchObject({
      code: "check_in_progress",
    });
    expect(() => operations.acquire("one", "write")).toThrow(AgentError);
    complete([MODEL]);
    await first;
    const fail = vi
      .spyOn(getDatabase(), "execute")
      .mockRejectedValueOnce(new Error("disk"));
    await expect(service.run(ADMIN, "one")).rejects.toThrow("disk");
    fail.mockRestore();
    expect(await service.run(ADMIN, "one")).toMatchObject({ models: [MODEL] });
    expect(await repository.catalogs().find("one")).toMatchObject({
      models: [MODEL],
    });
  });

  it("invalidates account-specific catalogs on key replacement and removes dependent catalog rows", async () => {
    const { service, repository } = await setup();
    await service.configure(ADMIN, "one", 6);
    await service.run(ADMIN, "one");
    await repository.update("one", {
      name: "First",
      secretEncrypted: null,
      testModel: "changed-model",
      reasoningEffort: null,
      clearModel: true,
      actorId: ADMIN.userId,
    });
    expect((await repository.catalogs().find("one")).models).toEqual([MODEL]);
    await repository.update("one", {
      name: "First",
      secretEncrypted: "replacement",
      testModel: null,
      reasoningEffort: null,
      clearModel: true,
      actorId: ADMIN.userId,
    });
    expect(await repository.catalogs().find("one")).toMatchObject({
      models: [],
      intervalHours: 6,
      refreshedAt: null,
      errorCode: null,
    });
    await repository.remove("one");
    expect(await repository.catalogs().find("one")).toEqual(
      emptyModelCatalog(),
    );
  });

  it("records undecryptable or missing secrets without making a listing request", async () => {
    const { service, repository, list } = await setup({
      secretEncrypted: "bad",
    });
    expect(await service.run(ADMIN, "one")).toMatchObject({
      errorCode: "secret_unavailable",
      models: [],
    });
    vi.spyOn(repository, "findSecretEncrypted").mockResolvedValueOnce(null);
    expect(await service.run(ADMIN, "one")).toMatchObject({
      errorCode: "secret_unavailable",
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("stagger-refreshes one overdue connection per tick, retries errors on cadence, and prevents overlapping batches", async () => {
    const { service, repository, scheduler, list, cipher } = await setup();
    await repository.insert({
      id: "two",
      name: "Second",
      provider: "openai",
      secretEncrypted: cipher.encrypt("two", "synthetic"),
      testModel: null,
      actorId: ADMIN.userId,
    });
    for (const id of ["one", "two"])
      await repository.catalogs().configure(id, 6, "2000-01-01T00:00:00.000Z");
    let complete: (models: readonly AgentCatalogModel[]) => void = () =>
      undefined;
    list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const batch = scheduler.runOnce();
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
    await scheduler.runOnce();
    expect(list).toHaveBeenCalledOnce();
    complete([MODEL]);
    await batch;
    list.mockRejectedValueOnce(new AgentError("provider_unavailable"));
    await scheduler.runOnce();
    expect(list).toHaveBeenCalledTimes(2);
    expect((await service.list(ADMIN)).two.errorCode).toBe(
      "provider_unavailable",
    );
    await scheduler.runOnce();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("starts one unrefed minute timer, stops without queries, drains and aborts in-flight requests", async () => {
    const { service, repository, scheduler, list } = await setup();
    vi.useFakeTimers();
    try {
      const run = vi.spyOn(scheduler, "runOnce").mockResolvedValue();
      scheduler.start();
      scheduler.start();
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(run).toHaveBeenCalledOnce();
      await scheduler.shutdown();
      expect(vi.getTimerCount()).toBe(0);
      await scheduler.shutdown();
      run.mockRestore();
      await scheduler.runOnce();
      expect(list).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
    const next = await setup({ id: "next", name: "Next" });
    next.list.mockImplementationOnce(
      async (_, __, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new AgentError("check_timeout")),
            { once: true },
          );
        }),
    );
    const pending = next.service.run(ADMIN, "next");
    await vi.waitFor(() => expect(next.list).toHaveBeenCalledOnce());
    await next.scheduler.shutdown();
    expect(await pending).toMatchObject({ errorCode: "check_timeout" });
    expect(await repository.catalogs().find("one")).toEqual(
      emptyModelCatalog(),
    );
    expect((await service.list(ADMIN)).one).toEqual(emptyModelCatalog());
  });

  it("rejects corrupted persisted timing and safely narrows unknown stored error codes", async () => {
    const { repository } = await setup();
    const query = vi.spyOn(getDatabase(), "query");
    query.mockResolvedValueOnce([[12, null, null, null, null, "[]"]]);
    await expect(repository.catalogs().find("one")).rejects.toMatchObject({
      code: "catalog_interval_invalid",
    });
    query.mockResolvedValueOnce([
      [0, null, null, null, "upstream-secret-code", "[]"],
    ]);
    expect((await repository.catalogs().find("one")).errorCode).toBeNull();
  });

  it("catches safe scheduler errors, and waits for a pending due-query during shutdown", async () => {
    const { scheduler, repository, refresh } = await setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const due = vi
      .spyOn(AgentCatalogRepository.prototype, "nextDue")
      .mockRejectedValueOnce(new Error("raw-secret"));
    await scheduler.runOnce();
    expect(warn).toHaveBeenCalledWith(
      "Pages model catalog refresh could not complete.",
    );
    let complete: (id: string | null) => void = () => undefined;
    due.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const run = scheduler.runOnce();
    const executor = vi.spyOn(refresh, "run");
    const stop = scheduler.shutdown();
    complete("one");
    await Promise.all([run, stop]);
    expect(executor).not.toHaveBeenCalled();
    expect(await repository.catalogs().find("one")).toEqual(
      emptyModelCatalog(),
    );
  });
});
