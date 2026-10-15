import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashAgentCredential } from "@/backend/security/AgentCredential";
import { PairingRateError } from "@/backend/service/mcp/PairingThrottle";

import {
  addressOf,
  advanceClock,
  CLOCK_START,
  DEVICE_INPUT,
  expectRejection,
  PairingWorld,
  rawCode,
  startClock,
} from "./pairing-world";

let world: PairingWorld;

beforeEach(() => {
  startClock();
  world = new PairingWorld();
  world.addUser("anna");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("begin", () => {
  it("answers with a ten minute request and a readable code", async () => {
    const started = await world.pairing.begin(DEVICE_INPUT, addressOf());

    expect(started).toMatchObject({
      apiVersion: "1",
      expiresAt: CLOCK_START + 600_000,
      interval: 5,
      service: "pages",
    });
    expect(started.userCode).toMatch(
      /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
    );
    expect(started.deviceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("stores only hashes of the code and of the device secret", async () => {
    const started = await world.pairing.begin(DEVICE_INPUT, addressOf());

    const [stored] = [...world.store.requests.values()];

    expect(stored).toMatchObject({
      codeHash: hashAgentCredential(rawCode(started.userCode)),
      secretHash: hashAgentCredential(started.deviceSecret),
      status: "pending",
      userId: null,
    });
    const persisted = JSON.stringify([...world.store.requests.values()]);
    expect(persisted).not.toContain(started.deviceSecret);
    expect(persisted).not.toContain(rawCode(started.userCode));
  });

  it("stores the trimmed client labels and the polling cadence", async () => {
    await world.pairing.begin(
      {
        clientName: "  Synthetic Client ",
        device: " Workstation ",
        packageVersion: " 2.0.1 ",
      },
      addressOf(),
    );

    expect([...world.store.requests.values()][0]).toMatchObject({
      clientName: "Synthetic Client",
      createdAt: CLOCK_START,
      csrfHash: null,
      device: "Workstation",
      expiresAt: CLOCK_START + 600_000,
      lastPollAt: null,
      packageVersion: "2.0.1",
      pollInterval: 5,
    });
  });

  it("issues a different code and secret for every request", async () => {
    const first = await world.start(addressOf("10.0.0.1"));
    const second = await world.start(addressOf("10.0.0.2"));

    expect(second.userCode).not.toBe(first.userCode);
    expect(second.deviceSecret).not.toBe(first.deviceSecret);
  });

  it("prunes old requests with the current time", async () => {
    await world.start();

    expect(world.store.writes).toEqual(["maintain", "insert"]);
  });
});

describe("begin input validation", () => {
  it.each([
    ["a missing client name", { device: "Box", packageVersion: "1" }],
    ["a blank device", { clientName: "C", device: " ", packageVersion: "1" }],
    [
      "a client name with a control character",
      { clientName: "C\nD", device: "Box", packageVersion: "1" },
    ],
    [
      "a client name above 100 characters",
      { clientName: "c".repeat(101), device: "Box", packageVersion: "1" },
    ],
    [
      "a package version above 32 characters",
      { clientName: "C", device: "Box", packageVersion: "1".repeat(33) },
    ],
    ["a numeric device", { clientName: "C", device: 7, packageVersion: "1" }],
  ])("refuses %s without storing anything", async (_, input) => {
    await expectRejection(
      world.pairing.begin(input, addressOf()),
      "invalid_request",
    );

    expect(world.store.writes).toEqual([]);
  });

  it("accepts a package version of 32 characters", async () => {
    const started = await world.pairing.begin(
      { ...DEVICE_INPUT, packageVersion: "1".repeat(32) },
      addressOf(),
    );

    expect(started.userCode).toHaveLength(9);
  });
});

describe("begin limits", () => {
  it("answers the sixth request of a minute with a rate error", async () => {
    for (let index = 0; index < 5; index += 1) {
      await world.start();
    }

    const attempt = world.pairing.begin(DEVICE_INPUT, addressOf());

    await expect(attempt).rejects.toBeInstanceOf(PairingRateError);
    await expect(attempt).rejects.toMatchObject({
      code: "slow_down",
      retryAfter: 60,
      status: 429,
    });
    expect(world.store.requests.size).toBe(5);
  });

  it("limits the uncollected requests of one address to ten", async () => {
    for (let index = 0; index < 10; index += 1) {
      await world.start();
      if (index % 4 === 3) advanceClock(61_000);
    }

    await expect(
      world.pairing.begin(DEVICE_INPUT, addressOf()),
    ).rejects.toMatchObject({ retryAfter: 600, status: 429 });
    expect(world.store.requests.size).toBe(10);
  });

  it("frees an open slot when the device cancels its request", async () => {
    const first = await world.start();
    for (let index = 1; index < 10; index += 1) {
      await world.start();
      if (index % 4 === 3) advanceClock(61_000);
    }

    await world.pairing.cancel(world.deviceInput(first));

    await expect(world.start()).resolves.toHaveProperty("userCode");
  });

  it("refuses a new request when 500 are open and stores nothing", async () => {
    world.store.openRequestCount = 500;

    await expect(
      world.pairing.begin(DEVICE_INPUT, addressOf()),
    ).rejects.toMatchObject({ retryAfter: 600, status: 429 });

    expect(world.store.requests.size).toBe(0);
  });

  it("accepts the 500th open request", async () => {
    world.store.openRequestCount = 499;

    await expect(world.start()).resolves.toBeDefined();
  });
});

describe("begin code collisions", () => {
  it("draws another code when the first one is taken", async () => {
    world.store.takenCodeLookups = 2;

    const started = await world.start();

    expect(world.store.lookups).toHaveLength(3);
    expect(world.store.lookups.at(-1)).toBe(
      hashAgentCredential(rawCode(started.userCode)),
    );
  });

  it("gives up after eight taken codes with a 503 and stores nothing", async () => {
    world.store.takenCodeLookups = 8;

    await expectRejection(
      world.pairing.begin(DEVICE_INPUT, addressOf()),
      "temporarily_unavailable",
      503,
    );

    expect(world.store.lookups).toHaveLength(8);
    expect(world.store.requests.size).toBe(0);
  });

  it("keeps no trace of a request whose insert failed", async () => {
    world.store.failures.add("insert");

    await expect(world.start()).rejects.toThrow("insert call failed");

    expect(world.store.requests.size).toBe(0);
  });
});
