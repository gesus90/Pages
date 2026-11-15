import { expect, it, vi } from "vitest";

import { POSTGRES_MIGRATIONS } from "@/backend/database/Migrations";
import { PlanBridgeGrantRepository } from "@/backend/database/repositories/agent/PlanBridgeGrantRepository";

import { parseMigrationSchema } from "../migration-schema";

import type { Database } from "@/backend/database/Database";

const GRANT = {
  bearerHash: "bearer-hash",
  credentialHash: "credential-hash",
  runId: "run",
  stepId: "step",
  instanceId: "instance",
  sealedToken: "sealed",
  expiresAt: 0,
};

function database(): Pick<Database, "query" | "execute"> {
  return {
    query: vi.fn<Database["query"]>(async () => []),
    execute: vi.fn(async () => {}),
  };
}

it("creates the grant table with exactly the columns the repository writes", () => {
  expect(
    parseMigrationSchema(POSTGRES_MIGRATIONS).get("agent_plan_bridge_grants"),
  ).toEqual([
    "bearer_hash",
    "credential_hash",
    "run_id",
    "step_id",
    "instance_id",
    "sealed_token",
    "expires_at",
    "created_at",
  ]);
  const migration = POSTGRES_MIGRATIONS.find(
    (candidate) => candidate.name === "066_plan_bridge_grants.sql",
  );
  expect(migration?.sql).toContain(
    "REFERENCES agent_run_credentials (token_hash) ON DELETE CASCADE",
  );
});

it("stores, finds and removes grants with bound parameters only", async () => {
  const connection = database();
  const repository = new PlanBridgeGrantRepository(connection);
  await repository.insert(GRANT, 1_000);
  expect(connection.execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO agent_plan_bridge_grants"),
    {
      bearer_hash: "bearer-hash",
      credential_hash: "credential-hash",
      run_id: "run",
      step_id: "step",
      instance_id: "instance",
      sealed_token: "sealed",
      expires_at: 0,
      created_at: 1_000,
    },
  );
  await expect(repository.find("missing")).resolves.toBeNull();
  vi.mocked(connection.query).mockResolvedValueOnce([
    [
      "bearer-hash",
      "credential-hash",
      "run",
      "step",
      "instance",
      "sealed",
      "1700000000000",
    ],
  ]);
  await expect(repository.find("bearer-hash")).resolves.toEqual({
    ...GRANT,
    expiresAt: 1_700_000_000_000,
  });
  expect(connection.query).toHaveBeenLastCalledWith(
    expect.stringContaining("WHERE bearer_hash = $bearer_hash"),
    { bearer_hash: "bearer-hash" },
  );
  await repository.delete("bearer-hash");
  expect(connection.execute).toHaveBeenLastCalledWith(
    expect.stringContaining("DELETE FROM agent_plan_bridge_grants"),
    { bearer_hash: "bearer-hash" },
  );
});

it("revokes the grants of one step or of a whole run", async () => {
  const connection = database();
  const repository = new PlanBridgeGrantRepository(connection);
  await repository.revoke("run", "step");
  expect(connection.execute).toHaveBeenLastCalledWith(
    expect.stringContaining("AND step_id = $step_id"),
    { run_id: "run", step_id: "step" },
  );
  await repository.revoke("run", null);
  expect(connection.execute).toHaveBeenLastCalledWith(
    expect.not.stringContaining("step_id"),
    { run_id: "run" },
  );
});
