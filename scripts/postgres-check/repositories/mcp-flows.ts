import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { McpDevicePairingRepository } from "@/backend/database/repositories/mcp/McpDevicePairingRepository";
import { McpDeviceRepository } from "@/backend/database/repositories/mcp/McpDeviceRepository";

import { call, prepare, refused, stored } from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type {
  NewMcpDeviceFromPairing,
  NewMcpPairing,
} from "@/backend/database/repositories/mcp/McpDevicePairingRepository";
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

const PAIRING_USER = "user-mcp-device";
const LIMITS = { startsPerWindow: 3, windowMs: ONE_MINUTE, openRequests: 2 };
const ONE_HOUR = 60 * ONE_MINUTE;

function pairingRequest(
  id: string,
  overrides: Partial<NewMcpPairing> = {},
): NewMcpPairing {
  return {
    id,
    userCodeHash: `code-${id}`,
    deviceSecretHash: `secret-${id}`,
    deviceName: "Büro-Rechner",
    clientVersion: "1.0.0",
    addressHash: "address-a",
    createdAt: NOW,
    expiresAt: NOW + ONE_HOUR,
    ...overrides,
  };
}

function pairings({ database }: RepositoryWorld): McpDevicePairingRepository {
  return new McpDevicePairingRepository(database);
}

function devices({ database }: RepositoryWorld): McpDeviceRepository {
  return new McpDeviceRepository(database);
}

function collected(
  id: string,
  tokenHash: string,
  pairedAt: number,
): NewMcpDeviceFromPairing {
  return {
    deviceId: `device-${id}`,
    tokenHash,
    pairedAt,
  };
}

/** Pairing requests of machines: limits, one decision, one collection, then use and revocation. */
export const MCP_DEVICE_FLOW: RepositoryFlow = {
  title: "mcp devices",
  steps: [
    prepare(`
      INSERT INTO users (id, username, display_name, password_hash, role, is_active)
      VALUES
          ('${PAIRING_USER}', 'mcp-device', 'Gerät Besitzer', 'h', 'employee', 1),
          ('${PAIRING_USER}-off', 'mcp-device-off', 'Gesperrt', 'h', 'employee', 0);
    `),
    call("McpDevicePairingRepository.findByCodeHash", (world) =>
      pairings(world).findByCodeHash("code-pair-a"),
    ),
    call("McpDevicePairingRepository.insertWithinLimits", (world) =>
      pairings(world).insertWithinLimits(pairingRequest("pair-a"), LIMITS),
    ),
    call("McpDevicePairingRepository.insertWithinLimits", (world) =>
      pairings(world).insertWithinLimits(
        pairingRequest("pair-same-code", { userCodeHash: "code-pair-a" }),
        LIMITS,
      ),
    ),
    refused("McpDevicePairingRepository.insertWithinLimits", (world) =>
      pairings(world).insertWithinLimits(
        pairingRequest("pair-bad", { deviceName: "" }),
        LIMITS,
      ),
    ),
    call("McpDevicePairingRepository.insertWithinLimits", (world) =>
      pairings(world).insertWithinLimits(
        pairingRequest("pair-b", { createdAt: NOW + 1 }),
        LIMITS,
      ),
    ),
    call("McpDevicePairingRepository.insertWithinLimits", (world) =>
      pairings(world).insertWithinLimits(
        pairingRequest("pair-c", { createdAt: NOW + 2 }),
        LIMITS,
      ),
    ),
    call("McpDevicePairingRepository.insertWithinLimits", (world) =>
      pairings(world).insertWithinLimits(
        pairingRequest("pair-c", { createdAt: NOW + 2 }),
        { ...LIMITS, openRequests: 10 },
      ),
    ),
    call("McpDevicePairingRepository.insertWithinLimits", (world) =>
      pairings(world).insertWithinLimits(
        pairingRequest("pair-d", { createdAt: NOW + 3 }),
        { ...LIMITS, openRequests: 10 },
      ),
    ),
    call("McpDevicePairingRepository.insertWithinLimits", (world) =>
      pairings(world).insertWithinLimits(
        pairingRequest("pair-d", { createdAt: NOW + 3 }),
        { ...LIMITS, openRequests: 10, startsPerWindow: 10 },
      ),
    ),
    call("McpDevicePairingRepository.findByCodeHash", (world) =>
      pairings(world).findByCodeHash("code-pair-a"),
    ),
    call("McpDevicePairingRepository.notePoll", (world) =>
      pairings(world).notePoll("pair-a", NOW + 10, 5000),
    ),
    call("McpDevicePairingRepository.notePoll", (world) =>
      pairings(world).notePoll("pair-a", NOW + 11, 5000),
    ),
    call("McpDevicePairingRepository.notePoll", (world) =>
      pairings(world).notePoll("pair-a", NOW + 6000, 5000),
    ),
    call("McpDevicePairingRepository.decide", (world) =>
      pairings(world).decide({
        id: "pair-a",
        userId: PAIRING_USER,
        status: "approved",
        now: NOW + 20,
      }),
    ),
    call("McpDevicePairingRepository.decide", (world) =>
      pairings(world).decide({
        id: "pair-a",
        userId: PAIRING_USER,
        status: "denied",
        now: NOW + 21,
      }),
    ),
    call("McpDevicePairingRepository.decide", (world) =>
      pairings(world).decide({
        id: "pair-b",
        userId: PAIRING_USER,
        status: "denied",
        now: NOW + 22,
      }),
    ),
    call("McpDevicePairingRepository.cancel", (world) =>
      pairings(world).cancel("pair-c"),
    ),
    call("McpDevicePairingRepository.cancel", (world) =>
      pairings(world).cancel("pair-c"),
    ),
    call("McpDevicePairingRepository.collect", (world) =>
      pairings(world).collect("pair-b", collected("b", "token-b", NOW), NOW),
    ),
    call("McpDevicePairingRepository.collect", (world) =>
      pairings(world).collect(
        "pair-a",
        collected("a", "token-a", NOW + 30),
        NOW + ONE_HOUR + 1,
      ),
    ),
    call("McpDevicePairingRepository.collect", (world) =>
      pairings(world).collect(
        "pair-a",
        collected("a", "token-a", NOW + 30),
        NOW + 30,
      ),
    ),
    call("McpDevicePairingRepository.collect", (world) =>
      pairings(world).collect(
        "pair-a",
        collected("again", "token-again", NOW + 31),
        NOW + 31,
      ),
    ),
    call("McpDevicePairingRepository.findByCodeHash", (world) =>
      pairings(world).findByCodeHash("code-pair-a"),
    ),
    prepare(`
      UPDATE mcp_device_pairing
      SET status = 'approved',
          user_id = '${PAIRING_USER}-off'
      WHERE id = 'pair-d';
    `),
    call("McpDevicePairingRepository.collect", (world) =>
      pairings(world).collect(
        "pair-d",
        collected("d", "token-d", NOW + 40),
        NOW + 40,
      ),
    ),
    call("McpDevicePairingRepository.insertWithinLimits", (world) =>
      pairings(world).insertWithinLimits(
        pairingRequest("pair-late", {
          addressHash: "address-b",
          createdAt: NOW + 2 * ONE_HOUR,
          expiresAt: NOW + 3 * ONE_HOUR,
        }),
        LIMITS,
      ),
    ),
    stored("SELECT id, status FROM mcp_device_pairing ORDER BY id;"),
    call("McpDeviceRepository.touchByTokenHash", (world) =>
      devices(world).touchByTokenHash("token-a", NOW + 50),
    ),
    call("McpDeviceRepository.touchByTokenHash", (world) =>
      devices(world).touchByTokenHash("token-unknown", NOW + 51),
    ),
    call("McpDeviceRepository.listForUser", (world) =>
      devices(world).listForUser(PAIRING_USER),
    ),
    call("McpDeviceRepository.revokeForUser", (world) =>
      devices(world).revokeForUser("device-a", "user-other", NOW + 60),
    ),
    prepare(`
      INSERT INTO mcp_device (id, user_id, name, client_version, token_hash, paired_at)
      VALUES
          ('device-x', '${PAIRING_USER}', 'Zweiter Rechner', '1.0.0', 'token-x', ${NOW + 1}),
          ('device-y', '${PAIRING_USER}', 'Dritter Rechner', '1.0.0', 'token-y', ${NOW + 1});
    `),
    call("McpDeviceRepository.listForUser", (world) =>
      devices(world).listForUser(PAIRING_USER),
    ),
    call("McpDeviceRepository.revokeByTokenHash", (world) =>
      devices(world).revokeByTokenHash("token-x", NOW + 70),
    ),
    call("McpDeviceRepository.revokeByTokenHash", (world) =>
      devices(world).revokeByTokenHash("token-x", NOW + 71),
    ),
    call("McpDeviceRepository.revokeForUser", (world) =>
      devices(world).revokeForUser("device-a", PAIRING_USER, NOW + 80),
    ),
    call("McpDeviceRepository.touchByTokenHash", (world) =>
      devices(world).touchByTokenHash("token-a", NOW + 81),
    ),
    prepare(`UPDATE users SET is_active = 0 WHERE id = '${PAIRING_USER}';`),
    call("McpDeviceRepository.touchByTokenHash", (world) =>
      devices(world).touchByTokenHash("token-y", NOW + 90),
    ),
    call("McpDeviceRepository.listForUser", (world) =>
      devices(world).listForUser(PAIRING_USER),
    ),
    stored("SELECT id, revoked_at, last_used_at FROM mcp_device ORDER BY id;"),
  ],
};
