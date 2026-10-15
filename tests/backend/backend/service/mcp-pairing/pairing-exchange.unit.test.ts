import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashAgentCredential } from "@/backend/security/AgentCredential";

import {
  addressOf,
  advanceClock,
  browserOf,
  CLOCK_START,
  expectRejection,
  PairingWorld,
  startClock,
} from "./pairing-world";

import type { StartedPairing } from "./pairing-world";

let world: PairingWorld;
let started: StartedPairing;

beforeEach(async () => {
  startClock();
  world = new PairingWorld();
  world.addUser("anna");
  started = await world.start();
});

afterEach(() => {
  vi.useRealTimers();
});

function storedRequest(): ReturnType<PairingWorld["store"]["requests"]["get"]> {
  return [...world.store.requests.values()][0];
}

describe("polling before approval", () => {
  it("asks an early device to slow down and lengthens the interval", async () => {
    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "slow_down",
    );

    expect(storedRequest()).toMatchObject({
      lastPollAt: CLOCK_START,
      pollInterval: 10,
    });
  });

  it("keeps the longer interval for the next polls", async () => {
    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "slow_down",
    );
    advanceClock(5_000);
    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "slow_down",
    );
    expect(storedRequest()?.pollInterval).toBe(15);

    advanceClock(15_000);

    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "authorization_pending",
    );
    expect(storedRequest()?.pollInterval).toBe(15);
  });

  it("answers authorization_pending for a patient device", async () => {
    advanceClock(5_000);

    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "authorization_pending",
    );

    expect(storedRequest()?.pollInterval).toBe(5);
    expect(world.store.tokens.size).toBe(0);
  });
});

describe("issuing the credential", () => {
  it("hands the device its credential exactly once", async () => {
    await world.approve(started, "anna", 30);
    advanceClock(5_000);

    const credential = await world.pairing.exchange(world.deviceInput(started));

    expect(credential).toMatchObject({
      account: { displayName: "Name of anna", username: "anna" },
      expiresAt: CLOCK_START + 5_000 + 30 * 86_400_000,
      name: "Work laptop",
    });
    expect(credential.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "invalid_grant",
    );
    expect(world.store.tokens.size).toBe(1);
  });

  it("persists only the hash and the audit facts of the credential", async () => {
    await world.approve(started, "anna", 7);
    advanceClock(5_000);

    const credential = await world.pairing.exchange(world.deviceInput(started));

    const stored = world.store.tokens.get(credential.tokenId);
    expect(stored?.hash).toBe(hashAgentCredential(credential.token));
    expect(stored?.summary).toMatchObject({
      device: "Workstation Alpha",
      revokedAt: null,
      source: "pairing",
      userId: "anna",
    });
    expect(JSON.stringify([...world.store.tokens.values()])).not.toContain(
      credential.token,
    );
    expect(storedRequest()?.status).toBe("consumed");
    expect(world.store.tokenOfRequest.get(storedRequest()?.id ?? "")).toBe(
      credential.tokenId,
    );
  });

  it("issues a credential without expiry for unlimited validity", async () => {
    const credential = await world.pairDevice("anna", 0);

    expect(credential.expiresAt).toBeNull();
  });

  it("makes the new credential usable for the account", async () => {
    const credential = await world.pairDevice("anna");

    await expect(world.tokens.verify(credential.token)).resolves.toMatchObject({
      isAdmin: false,
      userId: "anna",
    });
  });

  it("does not issue before the browser approved", async () => {
    advanceClock(5_000);

    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "authorization_pending",
    );

    expect(world.store.tokens.size).toBe(0);
  });

  it("answers access_denied after a denial and issues nothing", async () => {
    const csrf = await world.openForm(started, browserOf("anna"));
    await world.pairing.decide(
      { code: started.userCode, csrf, decision: "deny" },
      browserOf("anna"),
    );
    advanceClock(5_000);

    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "access_denied",
    );

    expect(world.store.tokens.size).toBe(0);
  });
});

describe("device authentication", () => {
  it.each([
    ["a wrong secret", { deviceSecret: "A".repeat(43) }],
    ["a short secret", { deviceSecret: "A".repeat(42) }],
    [
      "a secret with foreign characters",
      { deviceSecret: `${"A".repeat(42)}!` },
    ],
    ["a missing secret", { deviceSecret: undefined }],
    ["a wrong code", { userCode: "BCDFGHJK" }],
    ["a missing code", { userCode: undefined }],
  ])(
    "answers invalid_grant for %s without recording a poll",
    async (_, changes) => {
      await world.approve(started, "anna");
      advanceClock(5_000);
      world.store.writes.length = 0;

      await expectRejection(
        world.pairing.exchange({ ...world.deviceInput(started), ...changes }),
        "invalid_grant",
      );

      expect(world.store.writes).toEqual([]);
      expect(storedRequest()?.status).toBe("approved");
    },
  );

  it("does not accept the secret of another request", async () => {
    const other = await world.start(addressOf("10.0.0.9"));
    await world.approve(started, "anna");
    advanceClock(5_000);

    await expectRejection(
      world.pairing.exchange({
        deviceSecret: other.deviceSecret,
        userCode: started.userCode,
      }),
      "invalid_grant",
    );

    expect(world.store.tokens.size).toBe(0);
  });
});

describe("ended requests", () => {
  it("answers expired_token after the request time ran out", async () => {
    advanceClock(600_000);

    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "expired_token",
    );

    expect(storedRequest()?.status).toBe("expired");
  });

  it("answers expired_token for an approval nobody collected in time", async () => {
    advanceClock(590_000);
    await world.approve(started, "anna");
    advanceClock(70_000);

    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "expired_token",
    );

    expect(world.store.tokens.size).toBe(0);
  });

  it("answers expired_token after the device cancelled", async () => {
    await world.pairing.cancel(world.deviceInput(started));

    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "expired_token",
    );
  });
});

describe("failure handling", () => {
  it("issues nothing when the account became ineligible", async () => {
    await world.approve(started, "anna");
    advanceClock(5_000);
    world.changeUser("anna", { isActive: false });

    await expectRejection(
      world.pairing.exchange(world.deviceInput(started)),
      "invalid_token",
      401,
    );

    expect(world.store.tokens.size).toBe(0);
    expect(storedRequest()?.status).toBe("approved");
  });

  it("rolls the credential back when the request cannot be completed", async () => {
    await world.approve(started, "anna");
    advanceClock(5_000);
    world.store.failures.add("complete");

    await expect(
      world.pairing.exchange(world.deviceInput(started)),
    ).rejects.toThrow("complete call failed");

    expect(world.store.tokens.size).toBe(0);
    expect(storedRequest()?.status).toBe("approved");
  });

  it("lets the device collect after a storage failure", async () => {
    await world.approve(started, "anna");
    advanceClock(5_000);
    world.store.failures.add("tokens.insert");
    await expect(
      world.pairing.exchange(world.deviceInput(started)),
    ).rejects.toThrow();
    world.store.failures.clear();
    advanceClock(5_000);

    const credential = await world.pairing.exchange(world.deviceInput(started));

    expect(world.store.tokens.size).toBe(1);
    expect(credential.tokenId).toEqual(expect.any(String));
  });
});

describe("cancel", () => {
  it("cancels a pending request for the device that holds the secret", async () => {
    const result = await world.pairing.cancel(world.deviceInput(started));

    expect(result).toEqual({ cancelled: true });
    expect(storedRequest()?.status).toBe("cancelled");
  });

  it("refuses a wrong secret and leaves the request alone", async () => {
    await expectRejection(
      world.pairing.cancel({
        deviceSecret: "B".repeat(43),
        userCode: started.userCode,
      }),
      "invalid_grant",
    );

    expect(storedRequest()?.status).toBe("pending");
  });

  it("does not cancel or revoke a credential that was already collected", async () => {
    await world.approve(started, "anna");
    advanceClock(5_000);
    const credential = await world.pairing.exchange(world.deviceInput(started));

    await world.pairing.cancel(world.deviceInput(started));

    expect(storedRequest()?.status).toBe("consumed");
    expect(
      world.store.tokens.get(credential.tokenId)?.summary.revokedAt,
    ).toBeNull();
  });
});
