import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashAgentCredential } from "@/backend/security/AgentCredential";

import {
  advanceClock,
  CLOCK_START,
  expectRejection,
  PairingWorld,
  startClock,
} from "./pairing-world";

let world: PairingWorld;

beforeEach(() => {
  startClock();
  world = new PairingWorld();
  world.addUser("anna");
  world.addUser("root", { isAdmin: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("verify", () => {
  it("resolves the owner's current rights and records the use", async () => {
    const created = await world.tokens.create("anna", "Agent", null);

    const identity = await world.tokens.verify(created.token);

    expect(identity).toMatchObject({ isAdmin: false, userId: "anna" });
    expect(world.store.tokens.get(created.summary.id)?.summary.lastUsedAt).toBe(
      CLOCK_START,
    );
  });

  it("grants an administrator every capability", async () => {
    const created = await world.tokens.create("root", "Agent", null);

    const identity = await world.tokens.verify(created.token);

    expect(identity.isAdmin).toBe(true);
    expect(identity.permissions).toEqual(
      expect.arrayContaining(["write", "manage_users", "archive_projects"]),
    );
  });

  it("resolves the same identity from the stored hash", async () => {
    const created = await world.tokens.create("anna", "Agent", null);

    await expect(
      world.tokens.verifyHash(hashAgentCredential(created.token)),
    ).resolves.toMatchObject({ userId: "anna" });
  });

  it.each([["an unknown credential"], [""]])("refuses %j", async (token) => {
    await expectRejection(world.tokens.verify(token), "invalid_token", 401);

    expect(world.store.writes).toEqual([]);
  });

  it("refuses a hash given as the clear credential", async () => {
    const created = await world.tokens.create("anna", "Agent", null);

    await expectRejection(
      world.tokens.verify(hashAgentCredential(created.token)),
      "invalid_token",
      401,
    );
  });

  it("refuses an expired credential", async () => {
    const created = await world.tokens.create(
      "anna",
      "Agent",
      CLOCK_START + 5_000,
    );
    advanceClock(5_000);

    await expectRejection(
      world.tokens.verify(created.token),
      "invalid_token",
      401,
    );
  });

  it("refuses a credential of an account deactivated afterwards", async () => {
    const created = await world.tokens.create("anna", "Agent", null);
    world.changeUser("anna", { isActive: false });
    world.store.writes.length = 0;

    await expectRejection(
      world.tokens.verify(created.token),
      "invalid_token",
      401,
    );

    expect(world.store.writes).toEqual([]);
  });

  it("refuses a credential of an account that must change its password", async () => {
    const created = await world.tokens.create("anna", "Agent", null);
    world.changeUser("anna", { mustChangePassword: true });

    await expectRejection(
      world.tokens.verify(created.token),
      "invalid_token",
      401,
    );
  });

  it("follows a role change without a new credential", async () => {
    const created = await world.tokens.create("anna", "Agent", null);
    world.changeUser("anna", { isAdmin: true });

    await expect(world.tokens.verify(created.token)).resolves.toMatchObject({
      isAdmin: true,
    });
  });
});

describe("credential details", () => {
  it("describes the presented credential for a device", async () => {
    const paired = await world.pairDevice("anna", 10);

    const details = await world.tokens.credential(paired.token);

    expect(details).toEqual({
      expiresAt: paired.expiresAt,
      id: paired.tokenId,
      name: "Work laptop",
      rotationRequested: false,
    });
  });

  it("answers null for unknown and revoked credentials", async () => {
    const created = await world.tokens.create("anna", "Agent", null);
    await world.tokens.revoke("anna", created.summary.id);

    await expect(world.tokens.credential("unknown")).resolves.toBeNull();
    await expect(world.tokens.credential(created.token)).resolves.toBeNull();
  });
});

describe("rotation request", () => {
  it("marks a paired credential and shows it to the device", async () => {
    const paired = await world.pairDevice("anna");

    await world.tokens.requestRotation("anna", paired.tokenId);

    await expect(world.tokens.credential(paired.token)).resolves.toMatchObject({
      rotationRequested: true,
    });
  });

  it("refuses a manual credential", async () => {
    const created = await world.tokens.create("anna", "Agent", null);

    await expectRejection(
      world.tokens.requestRotation("anna", created.summary.id),
      "invalid_request",
    );
  });

  it("refuses the credential of another account", async () => {
    const paired = await world.pairDevice("anna");

    await expectRejection(
      world.tokens.requestRotation("root", paired.tokenId),
      "invalid_request",
    );

    expect(world.store.writes).not.toContain("tokens.requestRotation");
  });

  it("refuses a revoked credential", async () => {
    const paired = await world.pairDevice("anna");
    await world.tokens.revoke("anna", paired.tokenId);

    await expectRejection(
      world.tokens.requestRotation("anna", paired.tokenId),
      "invalid_request",
    );
  });
});

describe("rotateCredential", () => {
  it("replaces the secret of a paired device and keeps its expiry", async () => {
    const paired = await world.pairDevice("anna", 10);

    const rotated = await world.tokens.rotateCredential(paired.token);

    expect(rotated.token).not.toBe(paired.token);
    expect(rotated.expiresAt).toBe(paired.expiresAt);
    await expect(world.tokens.verify(rotated.token)).resolves.toMatchObject({
      userId: "anna",
    });
    expect(world.store.tokens.size).toBe(1);
  });

  it("clears an open rotation request", async () => {
    const paired = await world.pairDevice("anna");
    await world.tokens.requestRotation("anna", paired.tokenId);

    const rotated = await world.tokens.rotateCredential(paired.token);

    await expect(world.tokens.credential(rotated.token)).resolves.toMatchObject(
      { rotationRequested: false },
    );
  });

  it("does not let the replaced secret rotate again", async () => {
    const paired = await world.pairDevice("anna");
    await world.tokens.rotateCredential(paired.token);

    await expectRejection(
      world.tokens.rotateCredential(paired.token),
      "invalid_token",
      401,
    );
  });

  it("refuses a manual credential and leaves it valid", async () => {
    const created = await world.tokens.create("anna", "Agent", null);

    await expectRejection(
      world.tokens.rotateCredential(created.token),
      "invalid_token",
      401,
    );

    await expect(world.tokens.verify(created.token)).resolves.toBeDefined();
  });

  it("refuses an unknown credential", async () => {
    await expectRejection(
      world.tokens.rotateCredential("unknown"),
      "invalid_token",
      401,
    );
  });
});

describe("revokeCredential", () => {
  it("revokes exactly the presented connection", async () => {
    const first = await world.pairDevice("anna");
    advanceClock(1_000);
    const second = await world.pairDevice("anna");

    await expect(world.tokens.revokeCredential(first.token)).resolves.toEqual({
      revoked: true,
    });

    await expectRejection(
      world.tokens.verify(first.token),
      "invalid_token",
      401,
    );
    await expect(world.tokens.verify(second.token)).resolves.toBeDefined();
  });

  it("refuses an unknown credential", async () => {
    await expectRejection(
      world.tokens.revokeCredential("unknown"),
      "invalid_token",
      401,
    );
  });

  it("refuses a credential that is already revoked", async () => {
    const paired = await world.pairDevice("anna");
    await world.tokens.revokeCredential(paired.token);

    await expectRejection(
      world.tokens.revokeCredential(paired.token),
      "invalid_token",
      401,
    );
  });
});
