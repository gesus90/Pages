import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PairingRateError,
  PairingThrottle,
} from "@/backend/service/mcp/PairingThrottle";

import { addressOf, advanceClock, startClock, thrownBy } from "./pairing-world";

beforeEach(() => {
  startClock();
});

afterEach(() => {
  vi.useRealTimers();
});

function requestTimes(
  throttle: PairingThrottle,
  count: number,
  socket = "10.0.0.1",
): void {
  for (let attempt = 0; attempt < count; attempt += 1) {
    throttle.request(addressOf(socket));
  }
}

function failTimes(
  throttle: PairingThrottle,
  count: number,
  userId = "anna",
  socket = "10.0.0.1",
): void {
  for (let attempt = 0; attempt < count; attempt += 1) {
    throttle.browser(userId, addressOf(socket), true);
  }
}

describe("PairingRateError", () => {
  it("is a fixed slow_down answer with status 429 and a retry time", () => {
    const error = new PairingRateError(60);

    expect(error).toMatchObject({
      code: "slow_down",
      retryAfter: 60,
      status: 429,
    });
  });
});

describe("request limits", () => {
  it("allows five requests per minute and answers the sixth with 60 seconds", () => {
    const throttle = new PairingThrottle();
    requestTimes(throttle, 5);

    const error = thrownBy(() => throttle.request(addressOf()));

    expect(error).toBeInstanceOf(PairingRateError);
    expect(error).toMatchObject({ retryAfter: 60 });
  });

  it("allows the next request once the minute has passed", () => {
    const throttle = new PairingThrottle();
    requestTimes(throttle, 5);
    advanceClock(60_001);

    expect(thrownBy(() => throttle.request(addressOf()))).toBeNull();
  });

  it("answers the twenty-first request of an hour with 3600 seconds", () => {
    const throttle = new PairingThrottle();
    for (let batch = 0; batch < 5; batch += 1) {
      requestTimes(throttle, 4);
      advanceClock(61_000);
    }

    expect(thrownBy(() => throttle.request(addressOf()))).toMatchObject({
      retryAfter: 3600,
    });
  });

  it("counts addresses independently", () => {
    const throttle = new PairingThrottle();
    requestTimes(throttle, 5, "10.0.0.1");

    expect(thrownBy(() => throttle.request(addressOf("10.0.0.2")))).toBeNull();
  });

  it("limits a shared proxy key across different sockets", () => {
    const throttle = new PairingThrottle();
    for (let index = 0; index < 5; index += 1) {
      throttle.request(addressOf(`10.0.0.${index}`, "198.51.100.7"));
    }

    expect(
      thrownBy(() => throttle.request(addressOf("10.0.1.1", "198.51.100.7"))),
    ).toMatchObject({ retryAfter: 60 });
    expect(
      thrownBy(() => throttle.request(addressOf("10.0.1.1", "198.51.100.8"))),
    ).toBeNull();
  });

  it("shares one key between forwarded values with the same 200 characters", () => {
    const throttle = new PairingThrottle();
    const prefix = "x".repeat(200);
    for (let index = 0; index < 5; index += 1) {
      throttle.request(addressOf(`10.0.0.${index}`, `${prefix}${index}`));
    }

    expect(
      thrownBy(() =>
        throttle.request(addressOf("10.0.1.1", `${prefix}another`)),
      ),
    ).toMatchObject({ retryAfter: 60 });
  });
});

describe("open requests", () => {
  function startOpen(throttle: PairingThrottle, count: number): void {
    for (let index = 0; index < count; index += 1) {
      throttle.started(`open-${index}`, addressOf(), Date.now() + 600_000);
    }
  }

  it("refuses a request while ten are uncollected", () => {
    const throttle = new PairingThrottle();
    startOpen(throttle, 10);

    expect(thrownBy(() => throttle.request(addressOf()))).toMatchObject({
      retryAfter: 600,
    });
  });

  it("allows nine open requests", () => {
    const throttle = new PairingThrottle();
    startOpen(throttle, 9);

    expect(thrownBy(() => throttle.request(addressOf()))).toBeNull();
  });

  it("frees a slot when a request ended", () => {
    const throttle = new PairingThrottle();
    startOpen(throttle, 10);
    throttle.ended("open-3");

    expect(thrownBy(() => throttle.request(addressOf()))).toBeNull();
  });

  it("frees the slots of requests that expired", () => {
    const throttle = new PairingThrottle();
    startOpen(throttle, 10);
    advanceClock(600_001);

    expect(thrownBy(() => throttle.request(addressOf()))).toBeNull();
  });

  it("keeps an approved request open for its extended period", () => {
    const throttle = new PairingThrottle();
    startOpen(throttle, 10);
    for (let index = 0; index < 10; index += 1) {
      throttle.approved(`open-${index}`, Date.now() + 700_000);
    }
    advanceClock(650_000);

    expect(thrownBy(() => throttle.request(addressOf()))).toMatchObject({
      retryAfter: 600,
    });
  });

  it("never shortens the period of an approved request", () => {
    const throttle = new PairingThrottle();
    startOpen(throttle, 10);
    for (let index = 0; index < 10; index += 1) {
      throttle.approved(`open-${index}`, Date.now() + 1_000);
    }
    advanceClock(2_000);

    expect(thrownBy(() => throttle.request(addressOf()))).toMatchObject({
      retryAfter: 600,
    });
  });

  it("ignores the approval of an unknown request", () => {
    const throttle = new PairingThrottle();

    expect(() => throttle.approved("unknown", Date.now())).not.toThrow();
  });
});

describe("browser failure limits", () => {
  it("allows valid lookups without limit", () => {
    const throttle = new PairingThrottle();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      throttle.browser("anna", addressOf());
    }

    expect(thrownBy(() => throttle.browser("anna", addressOf()))).toBeNull();
  });

  it("locks the account after ten failures for fifteen minutes", () => {
    const throttle = new PairingThrottle();
    failTimes(throttle, 10);

    const error = thrownBy(() => throttle.browser("anna", addressOf()));

    expect(error).toBeInstanceOf(PairingRateError);
    expect(error).toMatchObject({ retryAfter: 900 });
  });

  it("does not lock after nine failures", () => {
    const throttle = new PairingThrottle();
    failTimes(throttle, 9);

    expect(thrownBy(() => throttle.browser("anna", addressOf()))).toBeNull();
  });

  it("reports the remaining lock time", () => {
    const throttle = new PairingThrottle();
    failTimes(throttle, 10);
    advanceClock(300_000);

    expect(thrownBy(() => throttle.browser("anna", addressOf()))).toMatchObject(
      { retryAfter: 600 },
    );
  });

  it("releases the lock after fifteen minutes", () => {
    const throttle = new PairingThrottle();
    failTimes(throttle, 10);
    advanceClock(900_001);

    expect(thrownBy(() => throttle.browser("anna", addressOf()))).toBeNull();
  });

  it("forgets failures that left the fifteen minute window", () => {
    const throttle = new PairingThrottle();
    failTimes(throttle, 9);
    advanceClock(900_001);
    failTimes(throttle, 9);

    expect(thrownBy(() => throttle.browser("anna", addressOf()))).toBeNull();
  });

  it("blocks the same socket for another account", () => {
    const throttle = new PairingThrottle();
    failTimes(throttle, 10, "anna", "10.0.0.1");

    expect(
      thrownBy(() => throttle.browser("ben", addressOf("10.0.0.1"))),
    ).toBeInstanceOf(PairingRateError);
  });

  it("blocks the same account from another socket", () => {
    const throttle = new PairingThrottle();
    failTimes(throttle, 10, "anna", "10.0.0.1");

    expect(
      thrownBy(() => throttle.browser("anna", addressOf("10.0.0.2"))),
    ).toBeInstanceOf(PairingRateError);
  });

  it("leaves an unrelated account on another socket alone", () => {
    const throttle = new PairingThrottle();
    failTimes(throttle, 10, "anna", "10.0.0.1");

    expect(
      thrownBy(() => throttle.browser("ben", addressOf("10.0.0.2"))),
    ).toBeNull();
  });

  it("does not let a forwarded header replace the socket identity", () => {
    const throttle = new PairingThrottle();
    failTimes(throttle, 10, "anna", "10.0.0.1");

    expect(
      thrownBy(() =>
        throttle.browser("ben", addressOf("10.0.0.1", "203.0.113.5")),
      ),
    ).toBeInstanceOf(PairingRateError);
  });
});

describe("memory bound", () => {
  it("refuses new requests when too many keys are tracked", () => {
    const throttle = new PairingThrottle();
    for (let index = 0; index < 5_000; index += 1) {
      throttle.request(addressOf(`socket-${index}`, `proxy-${index}`));
    }

    expect(
      thrownBy(() => throttle.request(addressOf("socket-new"))),
    ).toBeNull();
    expect(
      thrownBy(() => throttle.request(addressOf("socket-newer"))),
    ).toMatchObject({ code: "slow_down", retryAfter: 900, status: 429 });
  });

  it("recovers after the tracked requests are older than an hour", () => {
    const throttle = new PairingThrottle();
    for (let index = 0; index < 5_001; index += 1) {
      throttle.request(addressOf(`socket-${index}`, `proxy-${index}`));
    }
    advanceClock(3_600_001);

    expect(
      thrownBy(() => throttle.request(addressOf("socket-new"))),
    ).toBeNull();
  });
});
