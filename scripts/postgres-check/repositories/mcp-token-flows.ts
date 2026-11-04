import { PairingPreferenceRepository } from "@/backend/database/repositories/mcp/PairingPreferenceRepository";
import { PairingRepository } from "@/backend/database/repositories/mcp/PairingRepository";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";

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
import type { StoredPairingRequest } from "@/backend/database/repositories/mcp/PairingRepository";
import type { StoredPersonalToken } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";

const USER = "user-mcp";
const STRANGER = "user-mcp-stranger";
/** Beyond the range of a 32-bit integer, like every time of this area. */
const NOW = 1_800_000_000_000;
const ONE_MINUTE = 60_000;
const ONE_DAY = 86_400_000;
const FUTURE = NOW + 10 * 365 * ONE_DAY;

const REQUEST: StoredPairingRequest = {
  id: "pairing-a",
  codeHash: "code-a",
  secretHash: "secret-a",
  clientName: "Werkzeug",
  device: "Laptop ä",
  packageVersion: "1.2.3",
  createdAt: NOW,
  expiresAt: NOW + ONE_DAY,
  status: "pending",
  userId: null,
  decidedAt: null,
  name: null,
  validitySeconds: null,
  csrfHash: null,
  lastPollAt: null,
  pollInterval: 5,
};

const TOKEN: StoredPersonalToken = {
  id: "token-b",
  userId: USER,
  name: "Hand ä",
  createdAt: NOW,
  expiresAt: null,
  revokedAt: null,
  source: "manual",
  device: null,
  lastUsedAt: null,
  rotatedAt: null,
  rotationRequestedAt: null,
};

function pairings({ database }: RepositoryWorld): PairingRepository {
  return new PairingRepository(database);
}

function preferences({
  database,
}: RepositoryWorld): PairingPreferenceRepository {
  return new PairingPreferenceRepository(database);
}

function tokens({ database }: RepositoryWorld): PersonalAgentTokenRepository {
  return new PersonalAgentTokenRepository(database);
}

/** Personal tokens: valid hashes, rotation with its overlap, use and revocation. */
export const PERSONAL_TOKEN_FLOW: RepositoryFlow = {
  title: "personal tokens",
  steps: [
    call("PersonalAgentTokenRepository.list", (world) =>
      tokens(world).list(USER),
    ),
    call("PersonalAgentTokenRepository.insert", (world) =>
      tokens(world).insert(TOKEN, "hash-b"),
    ),
    call("PersonalAgentTokenRepository.insert", (world) =>
      tokens(world).insert(
        {
          ...TOKEN,
          id: "token-a",
          name: "Gekoppelt",
          source: "pairing",
          device: "Laptop",
          expiresAt: FUTURE,
        },
        "hash-a",
      ),
    ),
    call("PersonalAgentTokenRepository.insert", (world) =>
      tokens(world).insert(
        {
          ...TOKEN,
          id: "token-c",
          name: "Abgelaufen",
          source: "pairing",
          expiresAt: NOW - ONE_MINUTE,
          createdAt: NOW - 2 * ONE_MINUTE,
        },
        "hash-c",
      ),
    ),
    refused("PersonalAgentTokenRepository.insert", (world) =>
      tokens(world).insert({ ...TOKEN, id: "token-same-hash" }, "hash-a"),
    ),
    refused("PersonalAgentTokenRepository.insert", (world) =>
      tokens(world).insert(
        { ...TOKEN, id: "token-no-name", name: MISSING_TEXT },
        "hash-n",
      ),
    ),
    call("PersonalAgentTokenRepository.list", (world) =>
      tokens(world).list(USER),
    ),
    reversedInPostgres("personal_agent_tokens"),
    call("PersonalAgentTokenRepository.list", (world) =>
      tokens(world).list(USER),
    ),
    call("PersonalAgentTokenRepository.list", (world) =>
      tokens(world).list(STRANGER),
    ),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-a", NOW),
    ),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-c", NOW),
    ),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-unknown", NOW),
    ),
    call("PersonalAgentTokenRepository.describe", (world) =>
      tokens(world).describe("hash-a", NOW),
    ),
    call("PersonalAgentTokenRepository.describe", (world) =>
      tokens(world).describe("hash-c", NOW),
    ),
    call("PersonalAgentTokenRepository.used", (world) =>
      tokens(world).used("hash-a", NOW),
    ),
    call("PersonalAgentTokenRepository.used", (world) =>
      tokens(world).used("hash-a", NOW + ONE_MINUTE - 1),
    ),
    call("PersonalAgentTokenRepository.describe", (world) =>
      tokens(world).describe("hash-a", NOW),
    ),
    call("PersonalAgentTokenRepository.used", (world) =>
      tokens(world).used("hash-a", NOW + ONE_MINUTE),
    ),
    call("PersonalAgentTokenRepository.describe", (world) =>
      tokens(world).describe("hash-a", NOW),
    ),
    call("PersonalAgentTokenRepository.requestRotation", (world) =>
      tokens(world).requestRotation(USER, "token-b", NOW),
    ),
    call("PersonalAgentTokenRepository.requestRotation", (world) =>
      tokens(world).requestRotation(STRANGER, "token-a", NOW),
    ),
    call("PersonalAgentTokenRepository.requestRotation", (world) =>
      tokens(world).requestRotation(USER, "token-a", NOW),
    ),
    call("PersonalAgentTokenRepository.requestRotation", (world) =>
      tokens(world).requestRotation(USER, "token-a", NOW + 1),
    ),
    call("PersonalAgentTokenRepository.list", (world) =>
      tokens(world).list(USER),
    ),
    call("PersonalAgentTokenRepository.replaceHash", (world) =>
      tokens(world).replaceHash("hash-b", "hash-b2", NOW),
    ),
    call("PersonalAgentTokenRepository.replaceHash", (world) =>
      tokens(world).replaceHash("hash-c", "hash-c2", NOW),
    ),
    call("PersonalAgentTokenRepository.replaceHash", (world) =>
      tokens(world).replaceHash("hash-a", "hash-a2", NOW),
    ),
    refused("PersonalAgentTokenRepository.replaceHash", (world) =>
      tokens(world).replaceHash("hash-a2", "hash-b", NOW),
    ),
    stored(`
      SELECT
          id,
          token_hash,
          previous_token_hash,
          previous_valid_until,
          rotated_at,
          rotation_requested_at
      FROM personal_agent_tokens
      ORDER BY id;
    `),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-a", NOW + 299_999),
    ),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-a", NOW + 300_000),
    ),
    call("PersonalAgentTokenRepository.describe", (world) =>
      tokens(world).describe("hash-a", NOW + 1),
    ),
    call("PersonalAgentTokenRepository.used", (world) =>
      tokens(world).used("hash-a", NOW + 2),
    ),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-a", NOW + 3),
    ),
    // A hash may be the old one of one token and the current one of another.
    call("PersonalAgentTokenRepository.insert", (world) =>
      tokens(world).insert(
        { ...TOKEN, id: "token-0", userId: STRANGER, name: "Fremd" },
        "hash-a",
      ),
    ),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-a", NOW + 4),
    ),
    reversedInPostgres("personal_agent_tokens"),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-a", NOW + 4),
    ),
    call("PersonalAgentTokenRepository.describe", (world) =>
      tokens(world).describe("hash-a", NOW + 4),
    ),
    call("PersonalAgentTokenRepository.used", (world) =>
      tokens(world).used("hash-a2", NOW + 5),
    ),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-a", NOW + 6),
    ),
    call("PersonalAgentTokenRepository.revoke", (world) =>
      tokens(world).revoke(STRANGER, "token-a", NOW + 7),
    ),
    call("PersonalAgentTokenRepository.revoke", (world) =>
      tokens(world).revoke(USER, "token-a", NOW + 8),
    ),
    call("PersonalAgentTokenRepository.revoke", (world) =>
      tokens(world).revoke(USER, "token-a", NOW + 9),
    ),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-a2", NOW + 10),
    ),
    call("PersonalAgentTokenRepository.list", (world) =>
      tokens(world).list(USER),
    ),
    call("PersonalAgentTokenRepository.transaction", (world) =>
      tokens(world).transaction(async (repository) => {
        await repository.insert({ ...TOKEN, id: "token-kept" }, "hash-kept");
        return repository.findOwner("hash-kept", NOW);
      }),
    ),
    refused("PersonalAgentTokenRepository.transaction", (world) =>
      tokens(world).transaction(async (repository) => {
        await repository.insert({ ...TOKEN, id: "token-gone" }, "hash-gone");
        await repository.transaction((nested) =>
          nested.insert({ ...TOKEN, id: "token-gone-2" }, "hash-gone"),
        );
      }),
    ),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-gone", NOW),
    ),
    call("PersonalAgentTokenRepository.list", (world) =>
      tokens(world).list(STRANGER),
    ),
  ],
};

/** Pairing a device: request, form, decision, one issuance and the cleanup. */
export const PAIRING_FLOW: RepositoryFlow = {
  title: "mcp pairing",
  steps: [
    prepare(`
      INSERT INTO users (id, username, display_name, password_hash, role, must_change_password)
      VALUES
          ('${USER}', 'mcp-person', 'Person ä', 'hash', 'employee', 0),
          ('user-mcp-new', 'mcp-new', 'Neu', 'hash', 'employee', 1);
    `),
    call("PairingRepository.account", (world) => pairings(world).account(USER)),
    call("PairingRepository.account", (world) =>
      pairings(world).account("user-mcp-new"),
    ),
    call("PairingRepository.account", (world) =>
      pairings(world).account("user-unknown"),
    ),
    call("PairingRepository.find", (world) => pairings(world).find("code-a")),
    call("PairingRepository.insert", (world) =>
      pairings(world).insert(REQUEST),
    ),
    refused("PairingRepository.insert", (world) =>
      pairings(world).insert({ ...REQUEST, id: "pairing-same-code" }),
    ),
    refused("PairingRepository.insert", (world) =>
      pairings(world).insert({
        ...REQUEST,
        id: "pairing-no-client",
        codeHash: "code-no-client",
        clientName: MISSING_TEXT,
      }),
    ),
    call("PairingRepository.find", (world) => pairings(world).find("code-a")),
    call("PairingRepository.bind", (world) =>
      pairings(world).bind("pairing-a", "csrf-1", USER),
    ),
    call("PairingRepository.poll", (world) =>
      pairings(world).poll("pairing-a", NOW + 1, 10),
    ),
    call("PairingRepository.find", (world) => pairings(world).find("code-a")),
    call("PairingRepository.decide", (world) =>
      pairings(world).decide({
        ...REQUEST,
        status: "approved",
        userId: USER,
        decidedAt: NOW + 2,
        name: "Laptop",
        validitySeconds: 2_592_000,
        expiresAt: NOW + 2 * ONE_DAY,
      }),
    ),
    call("PairingRepository.decide", (world) =>
      pairings(world).decide({
        ...REQUEST,
        status: "denied",
        userId: STRANGER,
      }),
    ),
    call("PairingRepository.bind", (world) =>
      pairings(world).bind("pairing-a", "csrf-2", STRANGER),
    ),
    call("PairingRepository.find", (world) => pairings(world).find("code-a")),
    refused("PairingRepository.transaction", (world) =>
      pairings(world).transaction(async (repository) => {
        await repository
          .tokens()
          .insert({ ...TOKEN, id: "token-paired-x" }, "hash-x");
        await repository.complete("pairing-a", "consumed", "token-paired-x");
        await repository.insert({ ...REQUEST, id: "pairing-a" });
      }),
    ),
    call("PairingRepository.find", (world) => pairings(world).find("code-a")),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner("hash-x", NOW),
    ),
    call("PairingRepository.transaction", (world) =>
      pairings(world).transaction(async (repository) => {
        await repository.tokens().insert(
          {
            ...TOKEN,
            id: "token-paired",
            source: "pairing",
            createdAt: NOW - ONE_DAY,
            expiresAt: FUTURE,
          },
          "hash-paired",
        );
        await repository.complete("pairing-a", "consumed", "token-paired");
        await repository.transaction((nested) =>
          nested.poll("pairing-a", NOW + 3, 15),
        );
        return {
          days: await repository.preferences().get(USER),
          account: await repository.account(USER),
          request: await repository.find("code-a"),
        };
      }),
    ),
    call("PairingRepository.complete", (world) =>
      pairings(world).complete("pairing-a", "cancelled"),
    ),
    stored("SELECT status, token_id, csrf_hash FROM mcp_pairing_requests;"),
    call("PairingRepository.insert", (world) =>
      pairings(world).insert({
        ...REQUEST,
        id: "pairing-b",
        codeHash: "code-b",
      }),
    ),
    call("PairingRepository.complete", (world) =>
      pairings(world).complete("pairing-b", "expired"),
    ),
    call("PairingRepository.find", (world) => pairings(world).find("code-b")),
    ...["c", "d"].map((letter, index) =>
      call("PairingRepository.insert", (world) =>
        pairings(world).insert({
          ...REQUEST,
          id: `pairing-${letter}`,
          codeHash: `code-${letter}`,
          expiresAt: NOW + index,
        }),
      ),
    ),
    call("PairingRepository.maintain", (world) =>
      pairings(world).maintain(NOW),
    ),
    call("PairingRepository.maintain", (world) =>
      pairings(world).maintain(NOW + 3 * ONE_DAY),
    ),
    stored("SELECT id, status FROM mcp_pairing_requests ORDER BY id;"),
    refusedWithoutTable(
      "PairingRepository.maintain",
      "mcp_pairing_requests",
      (transaction) =>
        new PairingRepository({
          ...transaction,
          transaction: (work) => work(transaction),
        }).maintain(NOW),
    ),
  ],
};

/** The validity of paired connections, which also moves the end of active ones. */
export const PAIRING_PREFERENCE_FLOW: RepositoryFlow = {
  title: "mcp pairing preferences",
  steps: [
    prepare(`DELETE FROM personal_agent_tokens WHERE user_id = '${USER}';`),
    ...[
      { id: "validity-manual", source: "manual", expiresAt: FUTURE },
      { id: "validity-open", source: "pairing", expiresAt: null },
      { id: "validity-oauth", source: "oauth", expiresAt: FUTURE },
      { id: "validity-oauth-short", source: "oauth", expiresAt: NOW + 1 },
      { id: "validity-ended", source: "pairing", expiresAt: NOW - 1 },
    ].map(({ id, source, expiresAt }) =>
      prepare(
        `
        INSERT INTO personal_agent_tokens (
            id, user_id, name, token_hash, created_at, expires_at, source
        )
        VALUES ($id, '${USER}', $id, $id, ${String(NOW - ONE_DAY)}, CAST($expires_at AS BIGINT), $source);
      `,
        { id, source, expires_at: expiresAt },
      ),
    ),
    prepare(`
      INSERT INTO personal_agent_tokens (
          id, user_id, name, token_hash, created_at, expires_at, revoked_at
      )
      VALUES (
          'validity-revoked', '${USER}', 'x', 'validity-revoked',
          ${String(NOW - ONE_DAY)}, ${String(FUTURE)}, ${String(NOW)}
      );
    `),
    call("PairingPreferenceRepository.get", (world) =>
      preferences(world).get(USER),
    ),
    // A person without a token: no row is touched, whatever the number of days.
    call("PairingPreferenceRepository.set", (world) =>
      preferences(world).set("user-mcp-no-tokens", 365, NOW),
    ),
    call("PairingPreferenceRepository.get", (world) =>
      preferences(world).get("user-mcp-no-tokens"),
    ),
    // 365 days are beyond the range of a 32-bit integer in milliseconds.
    call("PairingPreferenceRepository.set", (world) =>
      preferences(world).set(USER, 365, NOW),
    ),
    call("PairingPreferenceRepository.get", (world) =>
      preferences(world).get(USER),
    ),
    stored(
      `SELECT id, expires_at FROM personal_agent_tokens WHERE user_id = '${USER}' ORDER BY id;`,
    ),
    call("PairingPreferenceRepository.set", (world) =>
      preferences(world).set(USER, 1, NOW),
    ),
    stored(
      `SELECT id, expires_at FROM personal_agent_tokens WHERE user_id = '${USER}' ORDER BY id;`,
    ),
    call("PairingPreferenceRepository.set", (world) =>
      preferences(world).set(USER, 0, NOW),
    ),
    stored(
      `SELECT id, expires_at FROM personal_agent_tokens WHERE user_id = '${USER}' ORDER BY id;`,
    ),
    refused("PairingPreferenceRepository.set", (world) =>
      preferences(world).set(USER, 366, NOW),
    ),
    call("PairingPreferenceRepository.get", (world) =>
      preferences(world).get(USER),
    ),
    prepare(`DELETE FROM personal_agent_tokens WHERE user_id = '${USER}';`),
    prepare("DELETE FROM mcp_pairing_preferences;"),
    prepare(`DELETE FROM users WHERE id IN ('${USER}', 'user-mcp-new');`),
  ],
};
