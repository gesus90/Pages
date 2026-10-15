import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
let csrf: string;

beforeEach(async () => {
  startClock();
  world = new PairingWorld();
  world.addUser("anna");
  world.addUser("ben");
  started = await world.start();
  csrf = await world.openForm(started, browserOf("anna"));
  world.store.writes.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

function approval(
  changes: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    code: started.userCode,
    confirmMatch: true,
    csrf,
    decision: "approve",
    name: "Work laptop",
    validityDays: 30,
    ...changes,
  };
}

function storedRequest(): ReturnType<PairingWorld["store"]["requests"]["get"]> {
  return [...world.store.requests.values()][0];
}

describe("approval", () => {
  it("stores the decision without creating or returning a credential", async () => {
    advanceClock(10_000);

    const result = await world.pairing.decide(approval(), browserOf("anna"));

    expect(result).toBeUndefined();
    expect(world.store.tokens.size).toBe(0);
    expect(storedRequest()).toMatchObject({
      csrfHash: null,
      decidedAt: CLOCK_START + 10_000,
      name: "Work laptop",
      status: "approved",
      userId: "anna",
      validitySeconds: 30 * 86_400,
    });
  });

  it("trims the name of the connection", async () => {
    await world.pairing.decide(
      approval({ name: "  Home office  " }),
      browserOf("anna"),
    );

    expect(storedRequest()?.name).toBe("Home office");
  });

  it("stores no expiry for unlimited validity", async () => {
    await world.pairing.decide(
      approval({ validityDays: 0 }),
      browserOf("anna"),
    );

    expect(storedRequest()?.validitySeconds).toBeNull();
  });

  it("accepts the code in lower case without the dash", async () => {
    await world.pairing.decide(
      approval({ code: started.userCode.replace("-", "").toLowerCase() }),
      browserOf("anna"),
    );

    expect(storedRequest()?.status).toBe("approved");
  });

  it("keeps the original expiry of a fresh request", async () => {
    advanceClock(60_000);

    await world.pairing.decide(approval(), browserOf("anna"));

    expect(storedRequest()?.expiresAt).toBe(started.expiresAt);
  });

  it("grants a collection grace period when approved shortly before expiry", async () => {
    advanceClock(590_000);

    await world.pairing.decide(approval(), browserOf("anna"));

    expect(storedRequest()?.expiresAt).toBe(CLOCK_START + 590_000 + 60_000);
  });
});

describe("denial", () => {
  it("ends the request without name, validity or confirmation", async () => {
    await world.pairing.decide(
      { code: started.userCode, csrf, decision: "deny" },
      browserOf("anna"),
    );

    expect(storedRequest()).toMatchObject({
      csrfHash: null,
      name: null,
      status: "denied",
      userId: "anna",
      validitySeconds: null,
    });
    expect(world.store.tokens.size).toBe(0);
  });
});

describe("refused input", () => {
  it.each([
    ["a missing code", { code: undefined }],
    ["a malformed code", { code: "ABC" }],
    ["a missing confirmation value", { csrf: undefined }],
    ["a numeric confirmation value", { csrf: 12 }],
    ["an unknown decision", { decision: "maybe" }],
    ["a missing decision", { decision: undefined }],
  ])("answers invalid_request for %s", async (_, changes) => {
    await expectRejection(
      world.pairing.decide(approval(changes), browserOf("anna")),
      "invalid_request",
    );

    expect(world.store.writes).toEqual([]);
    expect(storedRequest()?.status).toBe("pending");
  });

  it.each([
    ["no confirmation", { confirmMatch: undefined }],
    ["a string confirmation", { confirmMatch: "true" }],
    ["a false confirmation", { confirmMatch: false }],
  ])("requires the explicit code match: %s", async (_, changes) => {
    await expectRejection(
      world.pairing.decide(approval(changes), browserOf("anna")),
      "confirm_match_required",
    );

    expect(storedRequest()?.status).toBe("pending");
  });

  it.each([
    ["a blank name", { name: "  " }],
    ["a missing name", { name: undefined }],
    ["a name above 100 characters", { name: "n".repeat(101) }],
    ["negative validity", { validityDays: -1 }],
    ["validity above a year", { validityDays: 366 }],
    ["fractional validity", { validityDays: 0.5 }],
    ["textual validity", { validityDays: "30" }],
  ])("refuses an approval with %s", async (_, changes) => {
    await expectRejection(
      world.pairing.decide(approval(changes), browserOf("anna")),
      "invalid_request",
    );

    expect(storedRequest()?.status).toBe("pending");
  });

  it("does not ask for a name or validity when denying", async () => {
    await expect(
      world.pairing.decide(
        { code: started.userCode, csrf, decision: "deny", name: 5 },
        browserOf("anna"),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("browser binding", () => {
  it("refuses a confirmation value of another session", async () => {
    await expectRejection(
      world.pairing.decide(approval(), browserOf("anna", "other-session")),
      "access_denied",
      403,
    );

    expect(storedRequest()?.status).toBe("pending");
  });

  it("refuses a confirmation value that was never issued", async () => {
    await expectRejection(
      world.pairing.decide(approval({ csrf: "forged" }), browserOf("anna")),
      "access_denied",
      403,
    );
  });

  it("refuses a confirmation value taken over by another account", async () => {
    await expectRejection(
      world.pairing.decide(approval(), browserOf("ben")),
      "access_denied",
      403,
    );

    expect(storedRequest()?.status).toBe("pending");
  });

  it("invalidates the form of a session when another session opened the code", async () => {
    await world.openForm(started, browserOf("anna", "second-session"));

    await expectRejection(
      world.pairing.decide(approval(), browserOf("anna")),
      "access_denied",
      403,
    );
  });

  it("refuses a decision for a code that was never opened", async () => {
    const unopened = await world.start(addressOf("10.0.0.7"));

    await expectRejection(
      world.pairing.decide(
        approval({ code: unopened.userCode }),
        browserOf("anna"),
      ),
      "access_denied",
      403,
    );
  });
});

describe("request state", () => {
  it("refuses a second decision of the same request", async () => {
    await world.pairing.decide(approval(), browserOf("anna"));

    await expectRejection(
      world.pairing.decide(
        { code: started.userCode, csrf, decision: "deny" },
        browserOf("anna"),
      ),
      "invalid_grant",
    );

    expect(storedRequest()?.status).toBe("approved");
  });

  it("refuses an expired request", async () => {
    advanceClock(600_000);

    await expectRejection(
      world.pairing.decide(approval(), browserOf("anna")),
      "invalid_grant",
    );

    expect(storedRequest()?.status).toBe("pending");
  });

  it("refuses an unknown code", async () => {
    await expectRejection(
      world.pairing.decide(approval({ code: "BCDFGHJK" }), browserOf("anna")),
      "invalid_grant",
    );
  });

  it("refuses a request the device cancelled", async () => {
    await world.pairing.cancel(world.deviceInput(started));

    await expectRejection(
      world.pairing.decide(approval(), browserOf("anna")),
      "invalid_grant",
    );
  });
});

describe("account state", () => {
  it("refuses an account deactivated after opening the form", async () => {
    world.changeUser("anna", { isActive: false });

    await expectRejection(
      world.pairing.decide(approval(), browserOf("anna")),
      "invalid_token",
      401,
    );

    expect(storedRequest()?.status).toBe("pending");
  });

  it("refuses an account that must now change its password", async () => {
    world.changeUser("anna", { mustChangePassword: true });

    await expectRejection(
      world.pairing.decide(approval(), browserOf("anna")),
      "invalid_token",
      401,
    );
  });
});
