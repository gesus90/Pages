import { describe, expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";

import { createCatalogModel } from "../helpers/agents";
import { createScopeHarness, textAgent } from "../helpers/connection-scope";

describe("PAGE-19 migration 039", () => {
  it("names the migration after the next free number", () => {
    const names = DATABASE_MIGRATIONS.map((migration) => migration.name).sort();
    const index = names.indexOf("039_agent_connection_scopes.sql");

    // Later migrations (PAGE-29 adds 040) may follow; 039 stays the one after 038.
    expect(names[index - 1]).toMatch(/^038_/u);
    expect(names.filter((name) => name.startsWith("039_"))).toHaveLength(1);
  });

  it("gives every existing connection the global scope and changes nobody's access", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter((entry) => entry.name < "039"),
      );
      await database.execute(`
        INSERT INTO agent_connections (id, name, provider, secret_encrypted, created_by, updated_by)
        VALUES ('legacy-api', 'Legacy API', 'openrouter', 'synthetic-ciphertext', 'admin', 'admin');
        INSERT INTO agent_connections (id, name, provider, cli_logged_in_at, created_by, updated_by)
        VALUES ('legacy-cli', 'Legacy CLI', 'codex_cli', '2026-10-09T12:00:00Z', 'admin', 'admin');
        INSERT INTO agent_connections (id, name, provider, created_by, updated_by, is_active)
        VALUES ('legacy-off', 'Legacy disabled', 'codex_cli', 'admin', 'admin', FALSE);
      `);
      const existing = new AgentConnectionRepository(database);
      for (const id of ["legacy-api", "legacy-cli"])
        await existing.catalogs().save(
          id,
          {
            attemptedAt: "2026-10-09T12:00:00Z",
            errorCode: null,
            models: [
              createCatalogModel({
                id: "model-a",
                reasoning: "levels",
                reasoningEfforts: ["low", "medium"],
              }),
            ],
          },
          null,
        );
      await existing.checks().save(
        "legacy-api",
        "auth",
        {
          status: "passed",
          errorCode: null,
          detail: {},
          durationMs: 1,
          checkedAt: "2026-10-09T12:00:00Z",
        },
        "admin",
      );

      await database.migrate(DATABASE_MIGRATIONS);
      await database.migrate(DATABASE_MIGRATIONS);

      expect(
        await database.query(
          "SELECT connection_id, mode FROM agent_connection_scopes ORDER BY connection_id;",
        ),
      ).toEqual([
        ["legacy-api", "global"],
        ["legacy-cli", "global"],
        ["legacy-off", "global"],
      ]);
      expect(
        await database.query("SELECT 1 FROM agent_connection_scope_targets;"),
      ).toEqual([]);
      // Nothing else of the connections moved.
      expect(
        await database.query(
          "SELECT id, is_active FROM agent_connections ORDER BY id;",
        ),
      ).toEqual([
        ["legacy-api", 1],
        ["legacy-cli", 1],
        ["legacy-off", 0],
      ]);

      // With the services: the global scope adds no limit and no grant.
      const h = await createScopeHarness(database);
      const api = await h.profiles.save(
        h.admin,
        null,
        textAgent("legacy-api", {
          name: "Legacy API agent",
          targets: [{ kind: "person", targetId: h.carol.id }],
        }),
      );
      const cli = await h.profiles.save(
        h.admin,
        null,
        textAgent("legacy-cli", {
          name: "Legacy CLI agent",
          targets: [{ kind: "person", targetId: h.carol.id }],
        }),
      );
      expect(
        (await h.profiles.choices(h.carol.id, "text"))
          .map((choice) => choice.id)
          .sort(),
      ).toEqual([api, cli].sort());
      expect(await h.profiles.choices(h.bob.id, "text")).toEqual([]);
      expect(
        (await h.management.list(h.admin))
          .filter((entry) => entry.id.startsWith("legacy-"))
          .map((entry) => [entry.id, entry.scope.mode]),
      ).toEqual([
        ["legacy-api", "global"],
        ["legacy-cli", "global"],
        ["legacy-off", "global"],
      ]);
    } finally {
      await database.close();
    }
  });

  it("lets the database itself reject an unknown mode or target kind", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(DATABASE_MIGRATIONS);
      await expect(
        database.execute(
          "INSERT INTO agent_connection_scopes (connection_id, mode) VALUES ('x', 'everybody');",
        ),
      ).rejects.toThrow();
      await expect(
        database.execute(
          "INSERT INTO agent_connection_scope_targets (connection_id, kind, target_id) VALUES ('x', 'system', 'text');",
        ),
      ).rejects.toThrow();
      await expect(
        database.execute(
          "INSERT INTO agent_connection_scopes (connection_id, mode) VALUES (NULL, 'global');",
        ),
      ).rejects.toThrow();
    } finally {
      await database.close();
    }
  });
});
