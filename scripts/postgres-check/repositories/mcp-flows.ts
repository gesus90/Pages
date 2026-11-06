import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";

import { call, prepare, refused, stored } from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { RunCredentialRecord } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";

const USER = "user-mcp";
/** Beyond the range of a 32-bit integer, like every time of this area. */
const NOW = 1_800_000_000_000;
const ONE_MINUTE = 60_000;

const CREDENTIAL: RunCredentialRecord = {
  id: "credential-a",
  userId: USER,
  tokenHash: "run-hash-a",
  createdAt: NOW,
  expiresAt: NOW + ONE_MINUTE,
  scope: {
    runId: "run-a",
    stepId: "step-a",
    operations: ["read_ticket", "add_comment"],
    tickets: [{ id: "ticket-1", key: "PAGE-1" }],
    reach: "read",
  },
};

function credentials({
  database,
}: RepositoryWorld): AgentRunCredentialRepository {
  return new AgentRunCredentialRepository(database);
}

/** Credentials of agent plan sessions: found by hash, ended per node or per run. */
export const RUN_CREDENTIAL_FLOW: RepositoryFlow = {
  title: "run credentials",
  steps: [
    call("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-a", NOW),
    ),
    call("AgentRunCredentialRepository.insert", (world) =>
      credentials(world).insert(CREDENTIAL),
    ),
    call("AgentRunCredentialRepository.insert", (world) =>
      credentials(world).insert({
        ...CREDENTIAL,
        id: "credential-b",
        tokenHash: "run-hash-b",
        expiresAt: NOW - ONE_MINUTE,
        scope: { ...CREDENTIAL.scope, stepId: "step-b", reach: "full" },
      }),
    ),
    call("AgentRunCredentialRepository.insert", (world) =>
      credentials(world).insert({
        ...CREDENTIAL,
        id: "credential-c",
        tokenHash: "run-hash-c",
        scope: { ...CREDENTIAL.scope, stepId: "step-c" },
      }),
    ),
    refused("AgentRunCredentialRepository.insert", (world) =>
      credentials(world).insert({ ...CREDENTIAL, id: "credential-same-hash" }),
    ),
    call("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-a", NOW),
    ),
    call("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-b", NOW),
    ),
    prepare(`
      UPDATE agent_run_credentials
      SET reach = NULL,
          operations_json = '{}',
          ticket_ids_json = '[{"id":"ticket-2"},"Text",{"id":"ticket-3","key":"PAGE-3"}]'
      WHERE id = 'credential-c';
    `),
    call("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-c", NOW),
    ),
    prepare(
      "UPDATE agent_run_credentials SET ticket_ids_json = 'kein JSON' WHERE id = 'credential-c';",
    ),
    refused("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-c", NOW),
    ),
    call("AgentRunCredentialRepository.revoke", (world) =>
      credentials(world).revoke("run-a", "step-a", NOW),
    ),
    call("AgentRunCredentialRepository.revoke", (world) =>
      credentials(world).revoke("run-a", "step-a", NOW),
    ),
    call("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-a", NOW),
    ),
    call("AgentRunCredentialRepository.revoke", (world) =>
      credentials(world).revoke("run-a", null, NOW),
    ),
    stored(`
      SELECT
          id,
          revoked_at
      FROM agent_run_credentials
      ORDER BY id;
    `),
  ],
};
