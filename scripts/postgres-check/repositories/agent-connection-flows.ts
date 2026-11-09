import { AcpResourceRepository } from "@/backend/database/repositories/agent/AcpResourceRepository";
import { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import { AgentCatalogRepository } from "@/backend/database/repositories/agent/AgentCatalogRepository";
import { AgentCheckRepository } from "@/backend/database/repositories/agent/AgentCheckRepository";
import {
  CONNECTION_COLUMNS,
  readAgentConnection,
} from "@/backend/database/repositories/agent/AgentConnectionRows";
import { AgentConnectionScopeRepository } from "@/backend/database/repositories/agent/AgentConnectionScopeRepository";

import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { AcpResourceRecord } from "@/definition/AcpResource";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { AgentConnectionScope } from "@/definition/AgentConnectionScope";

const LEASE: AcpResourceRecord = {
  instanceId: "lease-b",
  userId: "user-admin",
  provider: "codex_cli",
  runId: "run-lease",
  stepId: null,
  state: "starting",
  since: "2026-03-01T08:00:00.000Z",
  namespace: null,
};

const MODEL: AgentCatalogModel = {
  id: "vendor/model-a",
  name: "Model A",
  contextWindow: 1000,
  promptPrice: "0.1",
  completionPrice: null,
  isFree: false,
  reasoning: "none",
  reasoningEfforts: [],
  defaultReasoningEffort: null,
};

const RESTRICTED: AgentConnectionScope = {
  mode: "restricted",
  targets: [
    { kind: "person", targetId: "user-admin" },
    { kind: "department", targetId: "department-scope" },
  ],
};

function leases({ database }: RepositoryWorld): AcpResourceRepository {
  return new AcpResourceRepository(database);
}

function assignments({ database }: RepositoryWorld): AgentAssignmentRepository {
  return new AgentAssignmentRepository(database);
}

function catalogs({ database }: RepositoryWorld): AgentCatalogRepository {
  return new AgentCatalogRepository(database);
}

function checks({ database }: RepositoryWorld): AgentCheckRepository {
  return new AgentCheckRepository(database);
}

function scopes({ database }: RepositoryWorld): AgentConnectionScopeRepository {
  return new AgentConnectionScopeRepository(database);
}

/** The capacity journal of the agent processes. */
export const ACP_RESOURCE_FLOW: RepositoryFlow = {
  title: "acp resources",
  steps: [
    call("AcpResourceRepository.list", (world) => leases(world).list()),
    call("AcpResourceRepository.save", (world) => leases(world).save(LEASE)),
    call("AcpResourceRepository.save", (world) =>
      leases(world).save({ ...LEASE, instanceId: "lease-a", runId: null }),
    ),
    call("AcpResourceRepository.save", (world) =>
      leases(world).save({
        ...LEASE,
        instanceId: "lease-c",
        since: "2026-02-01T08:00:00.000Z",
        namespace: {
          pid: 12,
          uid: 1000,
          start: 5,
          boot: "01234567-89ab-4def-8123-456789abcdef",
        },
      }),
    ),
    call("AcpResourceRepository.save", (world) =>
      leases(world).save({
        ...LEASE,
        state: "running",
        stepId: "step-1",
        since: "2030-01-01T00:00:00.000Z",
        userId: "user-other",
      }),
    ),
    reversedInPostgres("acp_resource_leases"),
    call("AcpResourceRepository.list", (world) => leases(world).list()),
    refused("AcpResourceRepository.save", (world) =>
      leases(world).save({
        ...LEASE,
        instanceId: "lease-invalid",
        state: "starting",
        userId: MISSING_TEXT,
      }),
    ),
    prepare(
      "UPDATE acp_resource_leases SET namespace_identity = 'kein JSON' WHERE instance_id = 'lease-a';",
    ),
    refused("AcpResourceRepository.list", (world) => leases(world).list()),
    call("AcpResourceRepository.remove", (world) =>
      leases(world).remove("lease-a"),
    ),
    call("AcpResourceRepository.remove", (world) =>
      leases(world).remove("lease-missing"),
    ),
    call("AcpResourceRepository.runReferences", (world) =>
      leases(world).runReferences([]),
    ),
    call("AcpResourceRepository.recordCheck", (world) =>
      leases(world).recordCheck("lease-c", {
        reason: "not_spawned",
        at: "2026-02-01T08:00:00.000Z",
      }),
    ),
    call("AcpResourceRepository.releaseUncertain", (world) =>
      leases(world).releaseUncertain("lease-c"),
    ),
    call("AcpResourceRepository.list", (world) => leases(world).list()),
    prepare("DELETE FROM acp_resource_leases;"),
  ],
};

/** Legacy function assignments, read through their view. */
export const ASSIGNMENT_FLOW: RepositoryFlow = {
  title: "agent assignments",
  steps: [
    call("AgentAssignmentRepository.list", (world) =>
      assignments(world).list(),
    ),
    prepare(`
      INSERT INTO agent_execution_profiles (id, name, connection_id, model, reasoning_effort, configuration_json)
      VALUES
          ('profile-assign-a', 'A', 'connection-a', 'model-a', NULL, '{}'),
          ('profile-assign-b', 'B', 'connection-b', 'model-b', 'high', '{}');
    `),
    prepare(`
      INSERT INTO agent_legacy_function_assignments (function, profile_id)
      VALUES ('skills', 'profile-assign-b');
    `),
    reversedInPostgres("agent_legacy_function_assignments"),
    call("AgentAssignmentRepository.list", (world) =>
      assignments(world).list(),
    ),
    call("AgentAssignmentRepository.remove", (world) =>
      assignments(world).remove("skills"),
    ),
    call("AgentAssignmentRepository.remove", ({ database }) =>
      database.transaction((transaction) =>
        new AgentAssignmentRepository(transaction).remove("skills"),
      ),
    ),
    call("AgentAssignmentRepository.list", (world) =>
      assignments(world).list(),
    ),
    prepare(`
      INSERT INTO agent_legacy_function_assignments (function, profile_id)
      VALUES ('unknown', 'profile-assign-a');
    `),
    refused("AgentAssignmentRepository.list", (world) =>
      assignments(world).list(),
    ),
    prepare("DELETE FROM agent_legacy_function_assignments;"),
    prepare(
      "DELETE FROM agent_execution_profiles WHERE id LIKE 'profile-assign-%';",
    ),
  ],
};

/** Model catalogs of a connection, with a refresh that fails and one that succeeds. */
export const CATALOG_FLOW: RepositoryFlow = {
  title: "agent catalogs",
  steps: [
    prepare(`
      INSERT INTO agent_connections (id, name, provider, created_by, updated_by)
      VALUES
          ('catalog-a', 'Katalog A', 'codex_cli', 'user-admin', 'user-admin'),
          ('catalog-b', 'Katalog B', 'codex_cli', 'user-admin', 'user-admin');
    `),
    call("AgentCatalogRepository.find", (world) =>
      catalogs(world).find("catalog-a"),
    ),
    call("AgentCatalogRepository.nextDue", (world) =>
      catalogs(world).nextDue("2026-03-01 00:00:00"),
    ),
    call("AgentCatalogRepository.configure", (world) =>
      catalogs(world).configure("catalog-a", 24, "2026-02-01 00:00:00"),
    ),
    call("AgentCatalogRepository.configure", (world) =>
      catalogs(world).configure("catalog-b", 24, "2026-02-01 00:00:00"),
    ),
    call("AgentCatalogRepository.configure", (world) =>
      catalogs(world).configure(
        "catalog-without-connection",
        24,
        "2020-01-01 00:00:00",
      ),
    ),
    reversedInPostgres("agent_model_catalogs"),
    call("AgentCatalogRepository.nextDue", (world) =>
      catalogs(world).nextDue("2026-03-01 00:00:00"),
    ),
    call("AgentCatalogRepository.nextDue", (world) =>
      catalogs(world).nextDue("2026-01-01 00:00:00"),
    ),
    call("AgentCatalogRepository.save", (world) =>
      catalogs(world).save(
        "catalog-a",
        {
          attemptedAt: "2026-03-01 01:00:00",
          errorCode: null,
          models: [MODEL],
        },
        "2026-03-02 01:00:00",
      ),
    ),
    call("AgentCatalogRepository.find", (world) =>
      catalogs(world).find("catalog-a"),
    ),
    call("AgentCatalogRepository.save", (world) =>
      catalogs(world).save(
        "catalog-a",
        {
          attemptedAt: "2026-03-01 02:00:00",
          errorCode: "provider_bad_response",
          models: null,
        },
        null,
      ),
    ),
    call("AgentCatalogRepository.find", (world) =>
      catalogs(world).find("catalog-a"),
    ),
    call("AgentCatalogRepository.invalidate", (world) =>
      catalogs(world).invalidate("catalog-a"),
    ),
    call("AgentCatalogRepository.find", (world) =>
      catalogs(world).find("catalog-a"),
    ),
    prepare(
      "UPDATE agent_model_catalogs SET models_json = 'kein JSON' WHERE connection_id = 'catalog-b';",
    ),
    refused("AgentCatalogRepository.find", (world) =>
      catalogs(world).find("catalog-b"),
    ),
    call("AgentCatalogRepository.remove", (world) =>
      catalogs(world).remove("catalog-a"),
    ),
    call("AgentCatalogRepository.remove", (world) =>
      catalogs(world).remove("catalog-b"),
    ),
    call("AgentCatalogRepository.remove", (world) =>
      catalogs(world).remove("catalog-without-connection"),
    ),
    call("AgentCatalogRepository.find", (world) =>
      catalogs(world).find("catalog-a"),
    ),
    prepare("DELETE FROM agent_connections WHERE id LIKE 'catalog-%';"),
  ],
};

/** The latest check of a connection per kind. */
export const CHECK_FLOW: RepositoryFlow = {
  title: "agent checks",
  steps: [
    call("AgentCheckRepository.find", (world) =>
      checks(world).find("connection-check", "auth"),
    ),
    call("AgentCheckRepository.save", (world) =>
      checks(world).save(
        "connection-check",
        "auth",
        {
          status: "passed",
          errorCode: null,
          checkedAt: "2026-03-01 08:00:00",
          durationMs: 12,
          detail: {},
        },
        "user-admin",
      ),
    ),
    call("AgentCheckRepository.save", (world) =>
      checks(world).save(
        "connection-check",
        "model",
        {
          status: "failed",
          errorCode: "provider_bad_response",
          checkedAt: "2026-03-01 08:01:00",
          durationMs: 34,
          detail: {},
        },
        "user-admin",
      ),
    ),
    call("AgentCheckRepository.find", (world) =>
      checks(world).find("connection-check", "auth"),
    ),
    call("AgentCheckRepository.find", (world) =>
      checks(world).find("connection-check", "model"),
    ),
    call("AgentCheckRepository.save", (world) =>
      checks(world).save(
        "connection-check",
        "model",
        {
          status: "passed",
          errorCode: null,
          checkedAt: "2026-03-01 08:02:00",
          durationMs: 56,
          detail: {},
        },
        "user-manager",
      ),
    ),
    call("AgentCheckRepository.find", (world) =>
      checks(world).find("connection-check", "model"),
    ),
    refused("AgentCheckRepository.save", (world) =>
      checks(world).save(
        "connection-check",
        "auth",
        {
          status: "passed",
          errorCode: "provider_bad_response",
          checkedAt: "2026-03-01 08:03:00",
          durationMs: 1,
          detail: {},
        },
        "user-admin",
      ),
    ),
    call("AgentCheckRepository.clearModel", (world) =>
      checks(world).clearModel("connection-check"),
    ),
    call("AgentCheckRepository.find", (world) =>
      checks(world).find("connection-check", "model"),
    ),
    call("AgentCheckRepository.find", (world) =>
      checks(world).find("connection-check", "auth"),
    ),
    call("AgentCheckRepository.clear", (world) =>
      checks(world).clear("connection-check"),
    ),
    call("AgentCheckRepository.find", (world) =>
      checks(world).find("connection-check", "auth"),
    ),
  ],
};

/** Who may use a connection, and the mapping of a connection row. */
export const CONNECTION_SCOPE_FLOW: RepositoryFlow = {
  title: "agent connection scopes",
  steps: [
    prepare(`
      INSERT INTO agent_connections (id, name, provider, secret_encrypted, reasoning_effort, created_by, updated_by)
      VALUES
          ('scope-b', 'beta', 'openrouter', 'cipher', 'low', 'user-admin', 'user-admin'),
          ('scope-a', 'Alpha', 'codex_cli', NULL, NULL, 'user-admin', 'user-admin');
    `),
    prepare(`
      INSERT INTO departments (id, name)
      VALUES ('department-scope', 'Bereich');
    `),
    call("AgentConnectionScopeRepository.find", (world) =>
      scopes(world).find("scope-missing"),
    ),
    call("AgentConnectionScopeRepository.find", (world) =>
      scopes(world).find("scope-a"),
    ),
    call("AgentConnectionScopeRepository.save", (world) =>
      scopes(world).save("scope-a", RESTRICTED),
    ),
    call("AgentConnectionScopeRepository.save", (world) =>
      scopes(world).save("scope-b", RESTRICTED),
    ),
    call("AgentConnectionScopeRepository.find", (world) =>
      scopes(world).find("scope-a"),
    ),
    reversedInPostgres("agent_connection_scope_targets"),
    call("AgentConnectionScopeRepository.list", (world) =>
      scopes(world).list(),
    ),
    call("AgentConnectionScopeRepository.list", ({ database }) =>
      database.readTransaction((transaction) =>
        new AgentConnectionScopeRepository(transaction).list(),
      ),
    ),
    // After a first statement both run it. No caller lists scopes in a transaction.
    call("AgentConnectionScopeRepository.list", ({ database }) =>
      database.transaction(async (transaction) => {
        await transaction.query("SELECT 1;");
        return new AgentConnectionScopeRepository(transaction).list();
      }),
    ),
    // As the first statement, DuckDB refuses the parallel start of the transaction.
    call("AgentConnectionScopeRepository.list", async ({ database }) => {
      const isListed = await database
        .transaction((transaction) =>
          new AgentConnectionScopeRepository(transaction).list(),
        )
        .then(
          () => true,
          () => false,
        );
      return { isAsKnown: isListed };
    }),
    call("AgentConnectionScopeRepository.references", (world) =>
      scopes(world).references({ kind: "person", targetId: "user-admin" }),
    ),
    call("AgentConnectionScopeRepository.references", (world) =>
      scopes(world).references({ kind: "group", targetId: "group-missing" }),
    ),
    refused("AgentConnectionScopeRepository.save", (world) =>
      scopes(world).save("scope-a", {
        mode: "restricted",
        targets: [{ kind: "group", targetId: "group-missing" }],
      }),
    ),
    call("AgentConnectionScopeRepository.save", (world) =>
      scopes(world).save("scope-b", { mode: "global", targets: [] }),
    ),
    call("AgentConnectionScopeRepository.find", (world) =>
      scopes(world).find("scope-b"),
    ),
    call("AgentConnectionScopeRepository.list", (world) =>
      scopes(world).list(),
    ),
    call("readAgentConnection", async ({ database }) =>
      (
        await database.query(`
          SELECT ${CONNECTION_COLUMNS}
          FROM agent_connections
          WHERE id LIKE 'scope-%'
          ORDER BY id;
        `)
      ).map(readAgentConnection),
    ),
    refused("readAgentConnection", async () =>
      readAgentConnection(["id", "name", "unknown-provider"]),
    ),
    refusedWithoutTable(
      "AgentConnectionScopeRepository.references",
      "agent_connection_scope_targets",
      (transaction) =>
        new AgentConnectionScopeRepository(transaction).references({
          kind: "person",
          targetId: "user-admin",
        }),
    ),
    call("AgentConnectionScopeRepository.remove", (world) =>
      scopes(world).remove("scope-a"),
    ),
    call("AgentConnectionScopeRepository.remove", (world) =>
      scopes(world).remove("scope-b"),
    ),
    stored(
      "SELECT COUNT(*) FROM agent_connection_scope_targets WHERE connection_id LIKE 'scope-%';",
    ),
    prepare("DELETE FROM agent_connections WHERE id LIKE 'scope-%';"),
    prepare("DELETE FROM departments WHERE id = 'department-scope';"),
  ],
};
