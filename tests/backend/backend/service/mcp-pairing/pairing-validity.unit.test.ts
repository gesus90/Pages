import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
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
  world.addUser("ben");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("validity preference", () => {
  it("reads thirty days for an account without a preference", async () => {
    await expect(world.pairing.validity("anna")).resolves.toBe(30);
  });

  it("reads the stored preference of the account only", async () => {
    world.store.preferences.set("anna", 90);

    await expect(world.pairing.validity("anna")).resolves.toBe(90);
    await expect(world.pairing.validity("ben")).resolves.toBe(30);
  });

  it("refuses to read it for an inactive account", async () => {
    world.changeUser("anna", { isActive: false });

    await expectRejection(world.pairing.validity("anna"), "invalid_token", 401);
  });

  it.each([[1], [180], [365], [0]])("stores %i days", async (days) => {
    await world.pairing.setValidity("anna", days);

    expect(world.store.preferenceWrites).toEqual([
      { days, now: CLOCK_START, userId: "anna" },
    ]);
    await expect(world.pairing.validity("anna")).resolves.toBe(days);
  });

  it.each([[-1], [366], [2.5], ["30"], [null], [undefined]])(
    "refuses %j and keeps the preference",
    async (days) => {
      await expectRejection(
        world.pairing.setValidity("anna", days),
        "invalid_request",
      );

      expect(world.store.preferenceWrites).toEqual([]);
    },
  );

  it("refuses an inactive account without writing", async () => {
    world.changeUser("anna", { isActive: false });

    await expectRejection(
      world.pairing.setValidity("anna", 30),
      "invalid_token",
      401,
    );

    expect(world.store.preferenceWrites).toEqual([]);
  });

  it("refuses an unknown account without writing", async () => {
    await expectRejection(
      world.pairing.setValidity("nobody", 30),
      "invalid_token",
      401,
    );

    expect(world.store.preferenceWrites).toEqual([]);
  });
});
