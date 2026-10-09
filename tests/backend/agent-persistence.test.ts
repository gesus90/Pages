import { describe, expect, it, vi } from "vitest";

import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";
import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AgentCheckRepository } from "@/backend/database/repositories/agent/AgentCheckRepository";
import { readAgentConnection } from "@/backend/database/repositories/agent/AgentConnectionRows";

import { useMigratedDatabase } from "../helpers/test-database";

import type { AgentCheckSummary } from "@/definition/AgentConnection";
import type { AgentConnectionWrite } from "@/backend/database/repositories/AgentConnectionRepository";

const PASSED: AgentCheckSummary = {
  status: "passed",
  errorCode: null,
  detail: { modelCount: 4 },
  durationMs: 14,
  checkedAt: "2026-10-08T10:00:00.000Z",
};
const FAILED: AgentCheckSummary = {
  ...PASSED,
  status: "failed",
  errorCode: "provider_auth_failed",
};

function connection(
  overrides: Partial<AgentConnectionWrite> = {},
): AgentConnectionWrite {
  return {
    id: "one",
    name: "First",
    provider: "openai",
    secretEncrypted: "ciphertext-marker",
    testModel: null,
    actorId: "admin",
    ...overrides,
  };
}

describe("agent migration and persistence", () => {
  const getDatabase = useMigratedDatabase();

  it("upgrades from 019 and can apply the full migration list twice", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter(
          (migration) => migration.name < "020_agent_connections.sql",
        ),
      );
      await database.migrate(DATABASE_MIGRATIONS);
      await database.migrate(DATABASE_MIGRATIONS);
      expect(await new AgentConnectionRepository(database).list()).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it("stores multiple connections per provider and rejects invalid secret/provider combinations", async () => {
    const repository = new AgentConnectionRepository(getDatabase());
    await repository.insert(connection());
    await repository.insert(connection({ id: "two", name: "Second" }));
    expect(await repository.count()).toBe(2);
    for (const input of [
      connection({ id: "invalid", name: "Invalid", provider: "codex_cli" }),
      connection({ id: "invalid", name: "Invalid", secretEncrypted: null }),
      connection({ id: "duplicate", name: "FIRST" }),
    ])
      await expect(repository.insert(input)).rejects.toThrow();
    await expect(
      getDatabase().execute(
        "UPDATE agent_connections SET provider = $provider WHERE id = $id;",
        { provider: "unsupported", id: "one" },
      ),
    ).rejects.toThrow();
    await expect(
      getDatabase().execute(
        "UPDATE agent_connections SET cli_logged_in_at = 'now' WHERE id = 'one';",
      ),
    ).rejects.toThrow();
    await repository.insert(
      connection({
        id: "cli",
        name: "CLI",
        provider: "codex_cli",
        secretEncrypted: null,
      }),
    );
    expect(await repository.findSecretEncrypted("cli")).toBeNull();
  });

  it("never selects ciphertext in safe metadata queries", async () => {
    const database = getDatabase();
    const repository = new AgentConnectionRepository(database);
    await repository.insert(connection());
    const query = vi.spyOn(database, "query");
    const listed = await repository.list();
    const found = await repository.find("one");
    expect(JSON.stringify([listed, found])).not.toContain("ciphertext-marker");
    expect(found).toMatchObject({
      hasApiKey: true,
      name: "First",
      provider: "openai",
    });
    for (const [statement] of query.mock.calls)
      expect(
        statement.replaceAll("secret_encrypted IS NOT NULL AS has_api_key", ""),
      ).not.toContain("secret_encrypted");
    expect(await repository.findSecretEncrypted("one")).toBe(
      "ciphertext-marker",
    );
    expect(await repository.findSecretEncrypted("missing")).toBeNull();
    expect(await repository.find("missing")).toBeNull();
    expect(() =>
      readAgentConnection([
        "id",
        "name",
        "unknown",
        1,
        null,
        null,
        null,
        "now",
      ]),
    ).toThrow();
  });

  it("upserts each check kind, attributes it, and atomically invalidates affected checks", async () => {
    const repository = new AgentConnectionRepository(getDatabase());
    await repository.insert(connection());
    expect(await repository.checks().find("one", "auth")).toBeNull();
    await repository.checks().save("one", "auth", PASSED, "checker");
    await repository.checks().save("one", "model", PASSED, "checker");
    await repository.checks().save("one", "auth", FAILED, "other");
    expect(await repository.checks().find("one", "auth")).toEqual(FAILED);
    expect(await repository.checks().find("one", "model")).toEqual(PASSED);
    expect(
      await getDatabase().query(
        "SELECT checked_by FROM agent_connection_checks WHERE kind = 'auth';",
      ),
    ).toEqual([["other"]]);
    await repository.update("one", {
      name: "FIRST",
      testModel: null,
      secretEncrypted: null,
      reasoningEffort: null,
      clearModel: false,
      actorId: "editor",
    });
    expect((await repository.find("one"))?.name).toBe("FIRST");
    expect(await repository.checks().find("one", "auth")).toEqual(FAILED);
    await repository.update("one", {
      name: "Renamed",
      testModel: "next",
      secretEncrypted: null,
      reasoningEffort: null,
      clearModel: true,
      actorId: "editor",
    });
    expect(await repository.checks().find("one", "model")).toBeNull();
    expect(await repository.findSecretEncrypted("one")).toBe(
      "ciphertext-marker",
    );
    await repository.update("one", {
      name: "Renamed",
      testModel: "next",
      secretEncrypted: "new-ciphertext",
      reasoningEffort: null,
      clearModel: false,
      actorId: "editor",
    });
    expect(await repository.checks().find("one", "auth")).toBeNull();
    expect(await repository.findSecretEncrypted("one")).toBe("new-ciphertext");
  });

  it("sets and clears CLI login metadata and deletes checks with their connection", async () => {
    const repository = new AgentConnectionRepository(getDatabase());
    await repository.insert(
      connection({ provider: "claude_code", secretEncrypted: null }),
    );
    await repository.checks().save("one", "auth", PASSED, "checker");
    await repository.setCliAccount(
      "one",
      { loggedInAt: "now", label: "Example" },
      "admin",
    );
    expect(await repository.find("one")).toMatchObject({
      cliLoggedInAt: "now",
      cliAccountLabel: "Example",
    });
    expect(await repository.checks().find("one", "auth")).toBeNull();
    await repository.setCliAccount(
      "one",
      { loggedInAt: null, label: null },
      "admin",
    );
    expect(await repository.find("one")).toMatchObject({
      cliLoggedInAt: null,
      cliAccountLabel: null,
    });
    await repository.checks().save("one", "auth", FAILED, "checker");
    await repository.remove("one");
    expect(await repository.find("one")).toBeNull();
    expect(await repository.checks().find("one", "auth")).toBeNull();
  });

  it("enforces check status/error invariants and sanitizes detail on write and read", async () => {
    const database = getDatabase();
    const repository = new AgentConnectionRepository(database);
    const detail = {
      ...PASSED.detail,
      token: "secret-marker",
      stdout: "raw-output",
    };
    await repository
      .checks()
      .save("one", "auth", { ...PASSED, detail }, "admin");
    expect(await repository.checks().find("one", "auth")).toEqual(PASSED);
    expect(
      JSON.stringify(
        await database.query(
          "SELECT detail_json FROM agent_connection_checks;",
        ),
      ),
    ).not.toContain("secret-marker");
    await expect(
      repository
        .checks()
        .save(
          "one",
          "auth",
          { ...PASSED, errorCode: "check_timeout" },
          "admin",
        ),
    ).rejects.toThrow();
    await expect(
      repository
        .checks()
        .save("one", "auth", { ...FAILED, errorCode: null }, "admin"),
    ).rejects.toThrow();
    const query = vi.fn();
    const checks = new AgentCheckRepository({ query, execute: vi.fn() });
    query.mockResolvedValue([["unknown", null, "{}", 0, "now"]]);
    await expect(checks.find("one", "auth")).rejects.toThrow();
    query.mockResolvedValue([["failed", "raw-marker", "{}", 0, "now"]]);
    await expect(checks.find("one", "auth")).rejects.toThrow();
    query.mockResolvedValue([
      ["passed", null, '{"token":"secret-marker","inputTokens":2}', 0, "now"],
    ]);
    expect((await checks.find("one", "auth"))?.detail).toEqual({
      inputTokens: 2,
    });
  });
});

describe("check detail whitelist", () => {
  it("accepts only finite measurements and bounded metadata", () => {
    expect(sanitizeCheckDetail(null)).toEqual({});
    expect(sanitizeCheckDetail("secret")).toEqual({});
    expect(
      sanitizeCheckDetail({
        modelCount: 1,
        limitRemaining: 2,
        inputTokens: 3,
        outputTokens: 4,
        costUsd: 0.1,
        hasMoreModels: true,
        isFreeTier: false,
        model: "model/one:free",
        endpoint: "api.example.com",
        cliVersion: "1.2.3",
        authMethod: "chatgpt",
        reasoningEffort: "xhigh",
        token: "discard",
      }),
    ).toEqual({
      modelCount: 1,
      limitRemaining: 2,
      inputTokens: 3,
      outputTokens: 4,
      costUsd: 0.1,
      hasMoreModels: true,
      isFreeTier: false,
      model: "model/one:free",
      endpoint: "api.example.com",
      cliVersion: "1.2.3",
      authMethod: "chatgpt",
      reasoningEffort: "xhigh",
    });
    expect(sanitizeCheckDetail({ reasoningEffort: "Very High" })).toEqual({});
    expect(sanitizeCheckDetail({ authMethod: "claude.ai" })).toEqual({
      authMethod: "claude.ai",
    });
    expect(
      sanitizeCheckDetail({
        modelCount: NaN,
        limitRemaining: -1,
        inputTokens: Infinity,
        outputTokens: "2",
        hasMoreModels: 1,
        model: "raw text\n",
        endpoint: "",
        cliVersion: "x".repeat(201),
        authMethod: "api_key",
      }),
    ).toEqual({});
  });
});
