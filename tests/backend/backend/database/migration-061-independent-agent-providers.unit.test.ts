import { expect, it } from "vitest";

import { POSTGRES_MIGRATIONS } from "@/backend/database/Migrations";

const SQL =
  POSTGRES_MIGRATIONS.find(
    (migration) => migration.name === "061_independent_agent_providers.sql",
  )?.sql ?? "";

it("requires an active verified API connection with a key and orders ambiguous candidates deterministically", () => {
  expect(SQL).toContain("connection.provider IN ('openrouter', 'zai')");
  expect(SQL).toContain("connection.is_active = TRUE");
  expect(SQL).toContain("connection.secret_encrypted IS NOT NULL");
  expect(SQL).toContain("auth.kind = 'auth'");
  expect(SQL).toContain("auth.status = 'passed'");
  expect(SQL).toContain("LOWER(connection.name),\n        connection.id");
  expect(SQL).toContain("WHERE source.provider = 'opencode'");
});

it("strips exactly the provider prefix, preserves reasoning and unmatched assignments, including native OpenCode models", () => {
  expect(SQL).toContain("target.provider || '/' AS prefix");
  expect(SQL).toContain(
    "LEFT(input ->> 'model', LENGTH(candidate.prefix)) = candidate.prefix",
  );
  expect(SQL).toContain("IF NOT FOUND THEN\n        RETURN input;");
  expect(SQL).toContain(
    "SUBSTRING(input ->> 'model' FROM LENGTH(route.prefix) + 1)",
  );
  expect(SQL).toContain("'connectionId', route.target_id");
  expect(SQL).toContain("'provider', route.provider");
  expect(SQL).not.toMatch(/reasoning[_A-Za-z]*\s*(?:=|',)/u);
});

it("recurses through nodes, groups and loops in every plan and pinned copy, including legacy profile references; never updates runs", () => {
  expect(SQL).toContain("jsonb_array_elements(input) WITH ORDINALITY");
  expect(SQL).toContain("page411_settings(value)");
  expect(SQL).toContain("profile.id = input ->> 'modelProfileId'");
  expect(SQL).toContain("UPDATE agent_execution_profiles AS profile");
  expect(SQL).toContain("UPDATE agent_plans");
  expect(SQL).toContain("UPDATE agent_plan_templates");
  expect(SQL.match(/UPDATE\s+\w+/gu)).toEqual([
    "UPDATE agent_execution_profiles",
    "UPDATE agent_plans",
    "UPDATE agent_plan_templates",
  ]);
  expect(SQL).not.toMatch(
    /(?:UPDATE|DELETE FROM)\s+(?:agent_plan_runs|agent_session|page_agent_run)/u,
  );
});
