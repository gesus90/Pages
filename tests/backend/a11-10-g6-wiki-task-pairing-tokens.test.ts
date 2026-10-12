import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import { hashAgentCredential } from "@/backend/security/AgentCredential";

import { authorizationFixture } from "../helpers/mcp-authorization";

import type { Database } from "@/backend/database/Database";
import type { StoredPersonalToken } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";

const NOW = Date.parse("2026-10-12T08:00:00Z");
const OWNER = "user-1";

let fixture: Awaited<ReturnType<typeof authorizationFixture>>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fixture = await authorizationFixture();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.database.close();
  vi.useRealTimers();
});

function storedToken(
  id: string,
  overrides: Partial<StoredPersonalToken> = {},
): StoredPersonalToken {
  return {
    id,
    userId: OWNER,
    name: `Token ${id}`,
    createdAt: NOW,
    expiresAt: null,
    revokedAt: null,
    source: "pairing",
    device: "laptop",
    lastUsedAt: null,
    rotatedAt: null,
    rotationRequestedAt: null,
    ...overrides,
  };
}

describe("personal agent token service", () => {
  it("describes the presented credential and nothing for an unknown one", async () => {
    const { token, summary } = await fixture.personal.create(
      OWNER,
      "Editor",
      null,
    );

    expect(await fixture.personal.credential(token)).toEqual({
      id: summary.id,
      name: "Editor",
      expiresAt: null,
      rotationRequested: false,
    });
    expect(await fixture.personal.credential("u".repeat(43))).toBeNull();
  });

  it("lets only an active paired credential be marked for rotation", async () => {
    const repository = fixture.personalRepository;
    const pairedToken = "p".repeat(43);
    await repository.insert(
      storedToken("paired"),
      hashAgentCredential(pairedToken),
    );
    await repository.insert(
      storedToken("manual", { source: "manual" }),
      hashAgentCredential("m".repeat(43)),
    );
    await repository.insert(
      storedToken("revoked"),
      hashAgentCredential("r".repeat(43)),
    );
    await fixture.personal.revoke(OWNER, "revoked");

    for (const id of ["missing", "manual", "revoked"])
      await expect(
        fixture.personal.requestRotation(OWNER, id),
      ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await fixture.personal.credential(pairedToken)).toMatchObject({
      rotationRequested: false,
    });

    await fixture.personal.requestRotation(OWNER, "paired");

    expect(await fixture.personal.credential(pairedToken)).toMatchObject({
      id: "paired",
      rotationRequested: true,
    });
  });

  it("revokes the presented connection and fails closed when it vanished meanwhile", async () => {
    const first = await fixture.personal.create(OWNER, "First", null);
    const second = await fixture.personal.create(OWNER, "Second", null);
    vi.spyOn(fixture.personalRepository, "describe").mockResolvedValueOnce(
      null,
    );

    await expect(
      fixture.personal.revokeCredential(first.token),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    expect(
      (await fixture.personal.list(OWNER)).map(({ status }) => status),
    ).toEqual(["active", "active"]);

    expect(await fixture.personal.revokeCredential(second.token)).toEqual({
      revoked: true,
    });
    await expect(fixture.personal.verify(second.token)).rejects.toMatchObject({
      code: "invalid_token",
    });
    expect(await fixture.personal.verify(first.token)).toMatchObject({
      userId: OWNER,
    });
  });
});

describe("personal agent token repository describe", () => {
  it("describes a valid hash and nothing for an unknown or revoked one", async () => {
    const repository = fixture.personalRepository;
    await repository.insert(storedToken("live"), "hash-live");
    await repository.insert(storedToken("gone"), "hash-gone");
    await repository.revoke(OWNER, "gone", NOW);

    expect(await repository.describe("hash-live", NOW)).toMatchObject({
      id: "live",
      userId: OWNER,
    });
    expect(await repository.describe("hash-unknown", NOW)).toBeNull();
    expect(await repository.describe("hash-gone", NOW)).toBeNull();
  });

  it("reports nothing when the token disappears between the two reads", async () => {
    const database = fixture.database;
    const vanishing: Pick<Database, "query" | "execute" | "transaction"> = {
      query: async (statement, parameters) => {
        const rows = await database.query(statement, parameters);
        if (statement.includes("SELECT user_id"))
          await database.execute("DELETE FROM personal_agent_tokens;");
        return rows;
      },
      execute: (statement, parameters) =>
        database.execute(statement, parameters),
      transaction: (work) => database.transaction(work),
    };
    await fixture.personalRepository.insert(storedToken("racing"), "hash-race");

    expect(
      await new PersonalAgentTokenRepository(vanishing).describe(
        "hash-race",
        NOW,
      ),
    ).toBeNull();
  });

  it("reports nothing when the hash also belongs to a token of someone else", async () => {
    const repository = fixture.personalRepository;
    // A revoked token of another account comes first in storage and shares the
    // hash with the rotation overlap of the live token.
    await repository.insert(
      storedToken("other", { userId: "user-2" }),
      "hash-shared",
    );
    await repository.insert(storedToken("live"), "hash-live");
    await fixture.database.execute(
      `
      UPDATE personal_agent_tokens
      SET previous_token_hash = 'hash-shared',
          previous_valid_until = $until
      WHERE id = 'live';
    `,
      { until: NOW + 300_000 },
    );
    await repository.revoke("user-2", "other", NOW);

    expect(await repository.findOwner("hash-shared", NOW)).toBe(OWNER);
    expect(await repository.describe("hash-shared", NOW)).toBeNull();
    expect(await repository.describe("hash-live", NOW)).toMatchObject({
      id: "live",
    });
  });
});
