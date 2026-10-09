import { describe, expect, it, vi } from "vitest";

import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import {
  AgentAccessDeniedError,
  AgentError,
} from "@/backend/error/AgentErrors";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentConnectionService } from "@/backend/service/agents/AgentConnectionService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import {
  AGENT_PROVIDERS,
  isAgentProvider,
  isApiProvider,
} from "@/definition/AgentConnection";

import { createCatalogModel } from "../helpers/agents";
import { createAccess } from "../helpers/authorization";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AgentCheckSummary } from "@/definition/AgentConnection";

const ADMIN = createAccess({ isAdmin: true, mode: "admin" });
const PASSED: AgentCheckSummary = {
  status: "passed",
  errorCode: null,
  detail: {},
  durationMs: 1,
  checkedAt: "2026-10-08T10:00:00Z",
};

describe("agent connection management", () => {
  const getDatabase = useMigratedDatabase();
  function setup() {
    const repository = new AgentConnectionRepository(getDatabase());
    const cipher = new InstanceSecretCipher(Buffer.alloc(32, 7));
    const operations = new AgentOperationRegistry();
    const cli = {
      describe: vi.fn().mockResolvedValue({
        binaryFound: false,
        loggedInAt: null,
        accountLabel: null,
        login: null,
        terminalCommand: "isolated-command",
      }),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    return {
      repository,
      cipher,
      operations,
      cli,
      service: new AgentConnectionService({
        repository,
        cipher,
        operations,
        cli,
      }),
    };
  }

  it("rejects every operation before any work unless an active admin uses admin mode", async () => {
    const { service, repository, cli } = setup();
    const list = vi.spyOn(repository, "list");
    for (const actor of [
      createAccess(),
      createAccess({ isAdmin: true }),
      createAccess({ isAdmin: true, mode: "admin", isActive: false }),
    ]) {
      await expect(service.list(actor)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
      await expect(
        service.create(actor, { name: "Test", provider: "codex_cli" }),
      ).rejects.toBeInstanceOf(AgentAccessDeniedError);
      await expect(
        service.update(actor, "id", { name: "Test" }),
      ).rejects.toBeInstanceOf(AgentAccessDeniedError);
      await expect(service.remove(actor, "id")).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
    }
    expect(list).not.toHaveBeenCalled();
    expect(cli.describe).not.toHaveBeenCalled();
  });

  it("manages all seven provider kinds without implicit provider requests", async () => {
    const { service, repository, cipher, cli } = setup();
    for (const provider of Object.keys(AGENT_PROVIDERS)) {
      if (!isAgentProvider(provider)) throw new Error("invalid fixture");
      const apiKey = isApiProvider(provider) ? "secret-marker" : undefined;
      const id = await service.create(ADMIN, {
        name: `  ${provider}  `,
        provider,
        apiKey,
        testModel: "model-v1",
      });
      expect(id).toMatch(/^[\da-f-]{36}$/);
      await service.update(ADMIN, id, {
        name: `${provider} renamed`,
        provider,
        testModel: "model-v2",
      });
      if (apiKey)
        expect(
          cipher.decrypt(id, (await repository.findSecretEncrypted(id)) ?? ""),
        ).toBe(apiKey);
    }
    const connections = await service.list(ADMIN);
    expect(connections).toHaveLength(7);
    expect(cli.describe).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(connections)).not.toMatch(/secret-marker|v1\./);
    for (const connection of connections)
      await service.remove(ADMIN, connection.id);
    expect(await service.list(ADMIN)).toEqual([]);
    expect(cli.cleanup).toHaveBeenCalledTimes(2);
  });

  it("validates each field and enforces immutable providers", async () => {
    const { service } = setup();
    const base = {
      name: "Test",
      provider: "openai",
      apiKey: "arbitrary-format-allowed",
    };
    const cases = [
      [{ provider: "unknown" }, "provider_invalid"],
      [{ provider: undefined }, "provider_invalid"],
      [{ name: "  " }, "name_required"],
      [{ name: "n".repeat(81) }, "name_too_long"],
      [{ apiKey: "" }, "api_key_required"],
      [{ apiKey: "k".repeat(513) }, "api_key_invalid_format"],
      [{ apiKey: "has space" }, "api_key_invalid_format"],
      [{ apiKey: "secret\u0000" }, "api_key_invalid_format"],
      [{ provider: "codex_cli" }, "api_key_invalid_format"],
      [{ testModel: "a".repeat(201) }, "test_model_invalid"],
      [{ testModel: "has space" }, "test_model_invalid"],
      [{ testModel: "model\n" }, "test_model_invalid"],
    ] as const;
    for (const [overrides, code] of cases)
      await expect(
        service.create(ADMIN, { ...base, ...overrides }),
      ).rejects.toMatchObject({ code });
    const id = await service.create(ADMIN, base);
    await expect(
      service.update(ADMIN, id, { name: "Test", provider: "anthropic" }),
    ).rejects.toMatchObject({ code: "provider_immutable" });
    await expect(
      service.update(ADMIN, "missing", { name: "Test" }),
    ).rejects.toMatchObject({ code: "connection_not_found" });
    await expect(service.remove(ADMIN, "missing")).rejects.toMatchObject({
      code: "connection_not_found",
    });
  });

  it("retains empty keys, resets checks on replacement, and resets only model results on model change", async () => {
    const { service, repository, cipher } = setup();
    const id = await service.create(ADMIN, {
      name: "Test",
      provider: "openai",
      apiKey: "first",
    });
    await repository.checks().save(id, "auth", PASSED, "admin");
    await repository.checks().save(id, "model", PASSED, "admin");
    await service.update(ADMIN, id, { name: "Renamed", apiKey: "" });
    expect((await service.list(ADMIN))[0].checks).toEqual({
      auth: PASSED,
      model: PASSED,
    });
    expect(
      cipher.decrypt(id, (await repository.findSecretEncrypted(id)) ?? ""),
    ).toBe("first");
    await service.update(ADMIN, id, { name: "Renamed", testModel: "next" });
    expect((await service.list(ADMIN))[0].checks).toEqual({
      auth: PASSED,
      model: null,
    });
    await service.update(ADMIN, id, { name: "Renamed", apiKey: "second" });
    expect((await service.list(ADMIN))[0].checks).toEqual({
      auth: null,
      model: null,
    });
    expect(
      cipher.decrypt(id, (await repository.findSecretEncrypted(id)) ?? ""),
    ).toBe("second");
  });

  it("saves only an effort the stored catalog lists for the chosen model and resets the model check", async () => {
    const { service, repository } = setup();
    await expect(
      service.create(ADMIN, {
        name: "Effort",
        provider: "openrouter",
        apiKey: "secret",
        reasoningEffort: "high",
      }),
    ).rejects.toMatchObject({ code: "reasoning_effort_unsupported" });
    const id = await service.create(ADMIN, {
      name: "Effort",
      provider: "openrouter",
      apiKey: "secret",
    });
    await repository.catalogs().save(
      id,
      {
        models: [
          createCatalogModel({
            id: "vendor/reasoner",
            reasoning: "levels",
            reasoningEfforts: ["low", "high"],
          }),
          createCatalogModel({ id: "vendor/plain", reasoning: "none" }),
        ],
        errorCode: null,
        attemptedAt: "2026-10-08T10:00:00.000Z",
      },
      null,
    );
    const choose = (testModel: string, reasoningEffort: string) =>
      service.update(ADMIN, id, { name: "Effort", testModel, reasoningEffort });
    for (const [model, effort, code] of [
      ["vendor/reasoner", "max", "reasoning_effort_unsupported"],
      ["vendor/plain", "low", "reasoning_effort_unsupported"],
      ["vendor/unlisted", "low", "reasoning_effort_unsupported"],
      ["vendor/reasoner", "Very High", "reasoning_effort_invalid"],
    ] as const)
      await expect(choose(model, effort)).rejects.toMatchObject({ code });
    await choose("vendor/reasoner", "high");
    expect((await service.list(ADMIN))[0]).toMatchObject({
      testModel: "vendor/reasoner",
      reasoningEffort: "high",
    });
    await repository.checks().save(id, "model", PASSED, "admin");
    // A catalog that later drops the level does not block other edits.
    await repository.catalogs().save(
      id,
      {
        models: [],
        errorCode: null,
        attemptedAt: "2026-10-09T10:00:00.000Z",
      },
      null,
    );
    await service.update(ADMIN, id, {
      name: "Renamed",
      testModel: "vendor/reasoner",
      reasoningEffort: "high",
    });
    expect((await service.list(ADMIN))[0].checks.model).toEqual(PASSED);
    await choose("vendor/reasoner", "");
    expect((await service.list(ADMIN))[0]).toMatchObject({
      reasoningEffort: null,
      checks: { model: null },
    });
  });

  it("allows duplicate providers but rejects case-insensitive duplicate names and preserves a failed rename", async () => {
    const { service } = setup();
    const first = await service.create(ADMIN, {
      name: "One",
      provider: "codex_cli",
    });
    const second = await service.create(ADMIN, {
      name: "Two",
      provider: "codex_cli",
    });
    await expect(
      service.create(ADMIN, { name: "ONE", provider: "codex_cli" }),
    ).rejects.toMatchObject({ code: "name_taken" });
    await expect(
      service.update(ADMIN, second, { name: "one" }),
    ).rejects.toMatchObject({ code: "name_taken" });
    await service.update(ADMIN, first, { name: "ONE" });
    expect((await service.list(ADMIN)).map((item) => item.name)).toEqual([
      "ONE",
      "Two",
    ]);
  });

  it("enforces the connection cap under concurrent creates", async () => {
    const { service, repository } = setup();
    for (let index = 0; index < 49; index++)
      await repository.insert({
        id: `id-${index}`,
        name: `Name ${index}`,
        provider: "codex_cli",
        secretEncrypted: null,
        testModel: null,
        actorId: "admin",
      });
    const results = await Promise.allSettled([
      service.create(ADMIN, { name: "Last", provider: "codex_cli" }),
      service.create(ADMIN, { name: "Excess", provider: "codex_cli" }),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { code: "connection_limit_reached" },
    });
    expect(await repository.count()).toBe(50);
  });

  it("retains the connection when CLI cleanup fails and orders cleanup before deletion", async () => {
    const { service, repository, cli } = setup();
    const id = await service.create(ADMIN, {
      name: "CLI",
      provider: "codex_cli",
    });
    cli.cleanup.mockRejectedValueOnce(
      new AgentError("credential_cleanup_failed"),
    );
    await expect(service.remove(ADMIN, id)).rejects.toMatchObject({
      code: "credential_cleanup_failed",
    });
    expect(await repository.find(id)).not.toBeNull();
    cli.cleanup.mockImplementationOnce(async () => {
      expect(await repository.find(id)).not.toBeNull();
    });
    await service.remove(ADMIN, id);
    expect(await repository.find(id)).toBeNull();
  });

  it("translates name constraints and propagates unexpected persistence failures", async () => {
    const { service, repository } = setup();
    const insert = vi.spyOn(repository, "insert");
    insert.mockRejectedValueOnce(new Error('Duplicate key "lower(name): one"'));
    await expect(
      service.create(ADMIN, { name: "One", provider: "codex_cli" }),
    ).rejects.toMatchObject({ code: "name_taken" });
    insert.mockRejectedValueOnce(
      new Error('Duplicate key "lower("name"): one"'),
    );
    await expect(
      service.create(ADMIN, { name: "One", provider: "codex_cli" }),
    ).rejects.toMatchObject({ code: "name_taken" });
    insert.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(
      service.create(ADMIN, { name: "One", provider: "codex_cli" }),
    ).rejects.toThrow("disk unavailable");
  });

  it("blocks mutation during an operation and releases locks after errors", async () => {
    const { service, operations } = setup();
    const id = await service.create(ADMIN, {
      name: "One",
      provider: "codex_cli",
    });
    const release = operations.acquire(id, "login");
    await expect(service.remove(ADMIN, id)).rejects.toMatchObject({
      code: "login_in_progress",
    });
    release();
    const releaseCheck = operations.acquire(id, "check");
    await expect(
      service.update(ADMIN, id, { name: "Two" }),
    ).rejects.toMatchObject({ code: "check_in_progress" });
    releaseCheck();
    await expect(
      operations.run(id, "write", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow();
    await service.update(ADMIN, id, { name: "Two" });
  });
});
