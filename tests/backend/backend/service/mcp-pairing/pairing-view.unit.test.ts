import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PairingRateError } from "@/backend/service/mcp/PairingThrottle";

import {
  addressOf,
  advanceClock,
  browserOf,
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
  world.addUser("ben", { isAdmin: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("view without a code", () => {
  it.each([[null], [undefined]])(
    "shows the entry form for %s with public account facts only",
    async (input) => {
      const view = await world.pairing.view(
        input,
        browserOf("ben"),
        addressOf(),
      );

      expect(view).toEqual({
        account: {
          displayName: "Name of ben",
          isAdmin: true,
          username: "ben",
        },
        code: "",
        status: "entry",
      });
    },
  );

  it("refuses an inactive account", async () => {
    world.addUser("cleo", { isActive: false });

    await expectRejection(
      world.pairing.view(null, browserOf("cleo"), addressOf()),
      "invalid_token",
      401,
    );
  });

  it("refuses an account that must change its password", async () => {
    world.addUser("dora", { mustChangePassword: true });

    await expectRejection(
      world.pairing.view(null, browserOf("dora"), addressOf()),
      "invalid_token",
      401,
    );
  });

  it("refuses an unknown account", async () => {
    await expectRejection(
      world.pairing.view(null, browserOf("nobody"), addressOf()),
      "invalid_token",
      401,
    );
  });

  it("refuses an identity the pairing table cannot approve", async () => {
    const account = world.store.accounts.get("anna");
    if (account) account.isEligible = false;

    await expectRejection(
      world.pairing.view(null, browserOf("anna"), addressOf()),
      "invalid_token",
      401,
    );
  });
});

describe("view of a pending request", () => {
  it("shows the client labels, the validity default and a confirmation value", async () => {
    const started = await world.start();

    const view = await world.pairing.view(
      started.userCode,
      browserOf("anna"),
      addressOf(),
    );

    expect(view).toMatchObject({
      account: { isAdmin: false, username: "anna" },
      clientName: "Synthetic Client",
      code: started.userCode,
      device: "Workstation Alpha",
      expiresAt: started.expiresAt,
      packageVersion: "1.4.2",
      status: "pending",
      validityDays: 30,
    });
    expect(view.csrf).toEqual(expect.any(String));
  });

  it("shows the personal validity preference", async () => {
    world.store.preferences.set("anna", 7);
    const started = await world.start();

    const view = await world.pairing.view(
      started.userCode,
      browserOf("anna"),
      addressOf(),
    );

    expect(view.validityDays).toBe(7);
  });

  it("accepts the code in lower case and without the dash", async () => {
    const started = await world.start();

    const view = await world.pairing.view(
      rawCode(started.userCode).toLowerCase(),
      browserOf("anna"),
      addressOf(),
    );

    expect(view).toMatchObject({ code: started.userCode, status: "pending" });
  });

  it("never exposes the device secret or a credential", async () => {
    const started = await world.start();

    const view = await world.pairing.view(
      started.userCode,
      browserOf("anna"),
      addressOf(),
    );

    expect(JSON.stringify(view)).not.toContain(started.deviceSecret);
    expect(Object.keys(view)).not.toContain("token");
    expect(Object.keys(view)).not.toContain("deviceSecret");
  });

  it("keeps the form valid when the same session opens it again", async () => {
    const started = await world.start();
    const first = await world.openForm(started, browserOf("anna"));
    advanceClock(30_000);

    const second = await world.openForm(started, browserOf("anna"));

    expect(second).toBe(first);
  });

  it("gives another session another confirmation value", async () => {
    const started = await world.start();
    const first = await world.openForm(started, browserOf("anna", "one"));

    const second = await world.openForm(started, browserOf("anna", "two"));

    expect(second).not.toBe(first);
  });

  it("changes nothing but the binding of the viewing account", async () => {
    const started = await world.start();
    await world.openForm(started, browserOf("anna"));

    expect(world.store.writes).toEqual(["maintain", "insert", "bind"]);
    expect([...world.store.requests.values()][0]).toMatchObject({
      status: "pending",
      userId: "anna",
    });
  });
});

describe("view of an unknown code", () => {
  it.each([
    ["an unknown code", "BCDFGHJK"],
    ["a malformed code", "not-a-code"],
    ["a number", 12345678],
  ])("answers invalid for %s without a code echo", async (_, input) => {
    const view = await world.pairing.view(
      input,
      browserOf("anna"),
      addressOf(),
    );

    expect(view).toMatchObject({ code: "", status: "invalid" });
    expect(view.csrf).toBeUndefined();
  });

  it("locks the browser after ten invalid codes, even for a valid one", async () => {
    const started = await world.start();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await world.pairing.view("BCDFGHJK", browserOf("anna"), addressOf());
    }

    const attempt = world.pairing.view(
      started.userCode,
      browserOf("anna"),
      addressOf(),
    );

    await expect(attempt).rejects.toBeInstanceOf(PairingRateError);
    await expect(attempt).rejects.toMatchObject({ retryAfter: 900 });
  });

  it("locks the address for other accounts as well", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await world.pairing.view("BCDFGHJK", browserOf("anna"), addressOf());
    }

    await expect(
      world.pairing.view(null, browserOf("ben"), addressOf()),
    ).rejects.toBeInstanceOf(PairingRateError);
  });

  it("allows the browser again after the lock expired", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await world.pairing.view("BCDFGHJK", browserOf("anna"), addressOf());
    }
    advanceClock(900_001);

    await expect(
      world.pairing.view(null, browserOf("anna"), addressOf()),
    ).resolves.toMatchObject({ status: "entry" });
  });
});

describe("view of a request in another state", () => {
  it("answers expired to the account that bound the form", async () => {
    const started = await world.start();
    await world.openForm(started, browserOf("anna"));
    advanceClock(600_001);

    const view = await world.pairing.view(
      started.userCode,
      browserOf("anna"),
      addressOf(),
    );

    expect(view).toMatchObject({ code: "", status: "expired" });
    expect([...world.store.requests.values()][0]?.status).toBe("expired");
  });

  it("answers invalid, not expired, to an account that never bound it", async () => {
    const started = await world.start();
    advanceClock(600_001);

    const view = await world.pairing.view(
      started.userCode,
      browserOf("ben"),
      addressOf(),
    );

    expect(view.status).toBe("invalid");
  });

  it("shows the decided state to the deciding account only", async () => {
    const started = await world.start();
    await world.approve(started, "anna");

    const own = await world.pairing.view(
      started.userCode,
      browserOf("anna"),
      addressOf(),
    );
    const foreign = await world.pairing.view(
      started.userCode,
      browserOf("ben"),
      addressOf(),
    );

    expect(own.status).toBe("approved");
    expect(own.expiresAt).toBeTypeOf("number");
    expect(own.csrf).toBeUndefined();
    expect(foreign).toMatchObject({ code: "", status: "invalid" });
  });
});
