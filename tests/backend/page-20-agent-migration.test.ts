import { describe, expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";

describe("PAGE-20 migration 042", () => {
  it("names the migration after the next free number", () => {
    const names = DATABASE_MIGRATIONS.map((migration) => migration.name).sort();
    const index = names.indexOf("042_page_agents.sql");

    expect(names[index - 1]).toMatch(/^041_/u);
    expect(names.filter((name) => name.startsWith("042_"))).toHaveLength(1);
  });

  it("keeps existing agents as administrator agents and gives ended runs no records", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter((entry) => entry.name < "042"),
      );
      await database.execute(`
        INSERT INTO agent_execution_profiles (id, name, connection_id, model, is_active)
        VALUES ('legacy-agent', 'Legacy', 'connection', 'model-a', TRUE);
        INSERT INTO agent_plan_runs (id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json)
        VALUES
            ('ended-run', 'plan', 'u1', 'p1', 'w1', '2026-10-01T10:00:00Z', 'succeeded', '{}', '{}'),
            ('failed-run', 'plan', 'u1', 'p1', 'w1', '2026-10-01T11:00:00Z', 'failed', '{}', '{}'),
            ('open-run', 'plan', 'u1', 'p1', 'w1', '2026-10-01T12:00:00Z', 'running', '{}', '{}');
      `);

      await database.migrate(DATABASE_MIGRATIONS);
      await database.migrate(DATABASE_MIGRATIONS);

      expect(
        await database.query(
          "SELECT owner_id, model_profile_id FROM agent_execution_profiles WHERE id = 'legacy-agent';",
        ),
      ).toEqual([[null, null]]);
      // A run that ended earlier never gets a record with an invented time and input.
      expect(
        await database.query(
          "SELECT plan_run_id FROM page_agent_archived_runs ORDER BY plan_run_id;",
        ),
      ).toEqual([["ended-run"], ["failed-run"]]);
      expect(
        await database.query("SELECT 1 FROM page_agent_run_records;"),
      ).toEqual([]);
      expect(
        await database.query("SELECT 1 FROM page_agent_run_inputs;"),
      ).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it("allows only the four terminal states and one record per agent and run", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);
    try {
      await database.migrate(DATABASE_MIGRATIONS);
      const record = (status: string, run = "run"): string => `
        INSERT INTO page_agent_run_records (
            agent_id, run_id, plan_run_id, user_id, started_at, finished_at,
            status, model, reasoning_effort, input, result
        ) VALUES (
            'agent', '${run}', 'plan-run', 'u1', 'start', 'end',
            '${status}', 'model-a', NULL, 'input', 'result'
        );`;
      for (const status of ["succeeded", "failed", "cancelled", "timeout"])
        await database.execute(record(status, status));
      await expect(
        database.execute(record("running", "other")),
      ).rejects.toThrow();
      await expect(
        database.execute(record("failed", "succeeded")),
      ).rejects.toThrow();
    } finally {
      await database.close();
    }
  });
});
