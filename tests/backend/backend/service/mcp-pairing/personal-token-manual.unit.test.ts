import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashAgentCredential } from "@/backend/security/AgentCredential";

import {
  advanceClock,
  CLOCK_START,
  expectRejection,
  PairingWorld,
  startClock,
} from "./pairing-world";

const DAY_MS = 86_400_000;

let world: PairingWorld;

beforeEach(() => {
  startClock();
  world = new PairingWorld();
  world.addUser("anna");
  world.addUser("ben");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("create", () => {
  it("returns the clear credential once and stores only its hash", async () => {
    const created = await world.tokens.create("anna", " Build agent ", null);

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.summary).toMatchObject({
      createdAt: CLOCK_START,
      device: null,
      expiresAt: null,
      name: "Build agent",
      revokedAt: null,
      source: "manual",
      status: "active",
      userId: "anna",
    });
    const stored = world.store.tokens.get(created.summary.id);
    expect(stored?.hash).toBe(hashAgentCredential(created.token));
    expect(JSON.stringify([...world.store.tokens.values()])).not.toContain(
      created.token,
    );
  });

  it("accepts an absolute expiry in the future", async () => {
    const expiresAt = CLOCK_START + DAY_MS;

    const created = await world.tokens.create("anna", "Agent", expiresAt);

    expect(created.summary.expiresAt).toBe(expiresAt);
  });

  it.each([
    ["a blank name", "  ", null],
    ["a name above 100 characters", "n".repeat(101), null],
    ["a non-string name", 7, null],
    ["an expiry now", "Agent", CLOCK_START],
    ["an expiry in the past", "Agent", CLOCK_START - 1],
    ["a fractional expiry", "Agent", CLOCK_START + 1.5],
    ["a textual expiry", "Agent", "tomorrow"],
    ["an omitted expiry", "Agent", undefined],
  ])("refuses %s and stores nothing", async (_, name, expiresAt) => {
    await expectRejection(
      world.tokens.create("anna", name, expiresAt),
      "invalid_request",
    );

    expect(world.store.tokens.size).toBe(0);
  });

  it("accepts a name of exactly 100 characters", async () => {
    const created = await world.tokens.create("anna", "n".repeat(100), null);

    expect(created.summary.name).toHaveLength(100);
  });

  it("refuses an inactive account", async () => {
    world.changeUser("anna", { isActive: false });

    await expectRejection(
      world.tokens.create("anna", "Agent", null),
      "invalid_token",
      401,
    );

    expect(world.store.tokens.size).toBe(0);
  });
});

describe("list", () => {
  it("shows only the credentials of the requesting account", async () => {
    await world.tokens.create("anna", "Anna agent", null);
    await world.tokens.create("ben", "Ben agent", null);

    const listed = await world.tokens.list("anna");

    expect(listed.map((token) => token.name)).toEqual(["Anna agent"]);
  });

  it("reports the state of each credential", async () => {
    const soon = await world.tokens.create(
      "anna",
      "Expiring",
      CLOCK_START + 1_000,
    );
    const revoked = await world.tokens.create("anna", "Revoked", null);
    await world.tokens.create("anna", "Active", null);
    await world.tokens.revoke("anna", revoked.summary.id);
    advanceClock(2_000);

    const listed = await world.tokens.list("anna");

    const states = Object.fromEntries(
      listed.map((token) => [token.name, token.status]),
    );
    expect(states).toEqual({
      Active: "active",
      Expiring: "expired",
      Revoked: "revoked",
    });
    expect(soon.summary.status).toBe("active");
  });

  it("hides credentials that ended more than ninety days ago", async () => {
    const old = await world.tokens.create("anna", "Old", null);
    await world.tokens.revoke("anna", old.summary.id);
    advanceClock(90 * DAY_MS - 1);
    expect(await world.tokens.list("anna")).toHaveLength(1);

    advanceClock(1);

    expect(await world.tokens.list("anna")).toHaveLength(0);
  });

  it("hides credentials that expired more than ninety days ago", async () => {
    await world.tokens.create("anna", "Short", CLOCK_START + DAY_MS);
    advanceClock(91 * DAY_MS);

    expect(await world.tokens.list("anna")).toHaveLength(0);
  });

  it("never returns a hash or a clear credential", async () => {
    const created = await world.tokens.create("anna", "Agent", null);

    const serialized = JSON.stringify(await world.tokens.list("anna"));

    expect(serialized).not.toContain(created.token);
    expect(serialized).not.toContain(hashAgentCredential(created.token));
  });
});

describe("revoke", () => {
  it("revokes the credential of the owner at once", async () => {
    const created = await world.tokens.create("anna", "Agent", null);

    await world.tokens.revoke("anna", created.summary.id);

    await expectRejection(
      world.tokens.verify(created.token),
      "invalid_token",
      401,
    );
    expect(world.store.tokens.get(created.summary.id)?.summary.revokedAt).toBe(
      CLOCK_START,
    );
  });

  it("cannot revoke the credential of another account", async () => {
    const created = await world.tokens.create("anna", "Agent", null);

    await world.tokens.revoke("ben", created.summary.id);

    await expect(world.tokens.verify(created.token)).resolves.toMatchObject({
      userId: "anna",
    });
  });

  it("keeps the first revocation time on a repeated revocation", async () => {
    const created = await world.tokens.create("anna", "Agent", null);
    await world.tokens.revoke("anna", created.summary.id);
    advanceClock(60_000);

    await world.tokens.revoke("anna", created.summary.id);

    expect(world.store.tokens.get(created.summary.id)?.summary.revokedAt).toBe(
      CLOCK_START,
    );
  });
});

describe("rotate", () => {
  it("replaces an active credential and keeps name and expiry", async () => {
    const expiresAt = CLOCK_START + 10 * DAY_MS;
    const original = await world.tokens.create("anna", "Agent", expiresAt);
    advanceClock(1_000);

    const replacement = await world.tokens.rotate("anna", original.summary.id);

    expect(replacement.token).not.toBe(original.token);
    expect(replacement.summary).toMatchObject({
      expiresAt,
      name: "Agent",
      userId: "anna",
    });
    expect(replacement.summary.id).not.toBe(original.summary.id);
    await expectRejection(
      world.tokens.verify(original.token),
      "invalid_token",
      401,
    );
    await expect(world.tokens.verify(replacement.token)).resolves.toMatchObject(
      {
        userId: "anna",
      },
    );
  });

  it.each([
    ["an unknown id", "missing"],
    ["a credential of another account", "ben-owned"],
  ])("refuses %s", async (_, target) => {
    const owned = await world.tokens.create("ben", "Ben agent", null);
    const id = target === "ben-owned" ? owned.summary.id : target;

    await expectRejection(world.tokens.rotate("anna", id), "invalid_request");

    expect(world.store.tokens.size).toBe(1);
    await expect(world.tokens.verify(owned.token)).resolves.toBeDefined();
  });

  it("refuses a revoked credential", async () => {
    const created = await world.tokens.create("anna", "Agent", null);
    await world.tokens.revoke("anna", created.summary.id);

    await expectRejection(
      world.tokens.rotate("anna", created.summary.id),
      "invalid_request",
    );

    expect(world.store.tokens.size).toBe(1);
  });

  it("refuses an expired credential", async () => {
    const created = await world.tokens.create(
      "anna",
      "Agent",
      CLOCK_START + 1_000,
    );
    advanceClock(1_000);

    await expectRejection(
      world.tokens.rotate("anna", created.summary.id),
      "invalid_request",
    );
  });

  it("refuses an inactive account", async () => {
    const created = await world.tokens.create("anna", "Agent", null);
    world.changeUser("anna", { isActive: false });

    await expectRejection(
      world.tokens.rotate("anna", created.summary.id),
      "invalid_token",
      401,
    );
  });

  it("keeps the old credential when the replacement cannot be stored", async () => {
    const original = await world.tokens.create("anna", "Agent", null);
    world.store.failures.add("tokens.insert");

    await expect(
      world.tokens.rotate("anna", original.summary.id),
    ).rejects.toThrow("tokens.insert call failed");

    expect(world.store.tokens.size).toBe(1);
    expect(
      world.store.tokens.get(original.summary.id)?.summary.revokedAt,
    ).toBeNull();
    await expect(world.tokens.verify(original.token)).resolves.toBeDefined();
  });
});
