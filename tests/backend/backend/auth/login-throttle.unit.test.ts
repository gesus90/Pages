import { describe, expect, it } from "vitest";

import {
  LoginThrottle,
  TooManyLoginAttemptsError,
} from "@/backend/auth/LoginThrottle";

const WINDOW_MS = 60_000;

function createThrottle(
  clock: { now: number },
  limits: { username?: number; address?: number; keys?: number } = {},
): LoginThrottle {
  return new LoginThrottle({
    windowMs: WINDOW_MS,
    maxFailuresPerUsername: limits.username ?? 3,
    maxFailuresPerAddress: limits.address ?? 5,
    maxTrackedKeys: limits.keys ?? 100,
    now: () => clock.now,
  });
}

function failTimes(
  throttle: LoginThrottle,
  count: number,
  username: string,
  address: string | null = null,
): void {
  for (let attempt = 0; attempt < count; attempt += 1) {
    throttle.recordFailure(username, address);
  }
}

describe("LoginThrottle", () => {
  it("allows attempts below the username limit", () => {
    const throttle = createThrottle({ now: 1_000 });
    failTimes(throttle, 2, "anna");

    expect(() => throttle.assertAllowed("anna", null)).not.toThrow();
  });

  it("blocks the username at its limit and reports the remaining seconds", () => {
    const clock = { now: 1_000 };
    const throttle = createThrottle(clock);
    failTimes(throttle, 3, "anna");
    clock.now += 10_000;

    expect(() => throttle.assertAllowed("anna", null)).toThrow(
      TooManyLoginAttemptsError,
    );
    try {
      throttle.assertAllowed("anna", null);
    } catch (error: unknown) {
      expect(error).toMatchObject({ retryAfterSeconds: 50 });
    }
  });

  it("treats names case-insensitively and ignores surrounding whitespace", () => {
    const throttle = createThrottle({ now: 1_000 });
    failTimes(throttle, 1, "Anna");
    failTimes(throttle, 1, " ANNA ");
    failTimes(throttle, 1, "anna");

    expect(() => throttle.assertAllowed("aNNa", null)).toThrow(
      TooManyLoginAttemptsError,
    );
  });

  it("keeps different usernames independent", () => {
    const throttle = createThrottle({ now: 1_000 });
    failTimes(throttle, 3, "anna");

    expect(() => throttle.assertAllowed("ben", null)).not.toThrow();
  });

  it("releases the block when the failures leave the window", () => {
    const clock = { now: 1_000 };
    const throttle = createThrottle(clock);
    failTimes(throttle, 3, "anna");
    clock.now += WINDOW_MS;

    expect(() => throttle.assertAllowed("anna", null)).not.toThrow();
  });

  it("blocks an address across different usernames", () => {
    const throttle = createThrottle({ now: 1_000 });
    for (const username of ["a", "b", "c", "d", "e"]) {
      throttle.recordFailure(username, "10.0.0.1");
    }

    expect(() => throttle.assertAllowed("new-user", "10.0.0.1")).toThrow(
      TooManyLoginAttemptsError,
    );
    expect(() => throttle.assertAllowed("new-user", "10.0.0.2")).not.toThrow();
    expect(() => throttle.assertAllowed("new-user", null)).not.toThrow();
  });

  it("forgets the username failures after a successful login", () => {
    const throttle = createThrottle({ now: 1_000 });
    failTimes(throttle, 3, "anna");
    throttle.recordSuccess(" Anna");

    expect(() => throttle.assertAllowed("anna", null)).not.toThrow();
  });

  it("drops the oldest tracked keys when too many keys are held", () => {
    const throttle = createThrottle({ now: 1_000 }, { username: 1, keys: 2 });
    failTimes(throttle, 1, "first");
    failTimes(throttle, 1, "second");
    failTimes(throttle, 1, "third");

    expect(() => throttle.assertAllowed("first", null)).not.toThrow();
    expect(() => throttle.assertAllowed("third", null)).toThrow(
      TooManyLoginAttemptsError,
    );
  });

  it("uses the real clock and the default limits without options", () => {
    const throttle = new LoginThrottle();
    failTimes(throttle, 9, "anna");
    expect(() => throttle.assertAllowed("anna", null)).not.toThrow();

    failTimes(throttle, 1, "anna");
    expect(() => throttle.assertAllowed("anna", null)).toThrow(
      "Too many failed login attempts.",
    );
  });
});
