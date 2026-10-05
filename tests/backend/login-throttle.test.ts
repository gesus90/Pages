import { describe, expect, it } from "vitest";

import {
  LoginThrottle,
  TooManyLoginAttemptsError,
} from "@/backend/auth/LoginThrottle";

function createClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 1_000_000;

  return {
    advance: (ms: number): void => {
      current += ms;
    },
    now: (): number => current,
  };
}

describe("LoginThrottle", () => {
  it("allows attempts below the limit", () => {
    const throttle = new LoginThrottle({ maxFailuresPerUsername: 3 });

    throttle.recordFailure("admin", null);
    throttle.recordFailure("admin", null);

    expect(() => throttle.assertAllowed("admin", null)).not.toThrow();
  });

  it("rejects attempts once the username limit is reached", () => {
    const throttle = new LoginThrottle({ maxFailuresPerUsername: 3 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      throttle.recordFailure("admin", null);
    }

    expect(() => throttle.assertAllowed("admin", null)).toThrow(
      TooManyLoginAttemptsError,
    );
  });

  it("treats usernames case-insensitively and ignores surrounding blanks", () => {
    const throttle = new LoginThrottle({ maxFailuresPerUsername: 2 });

    throttle.recordFailure("Admin", null);
    throttle.recordFailure("  admin ", null);

    expect(() => throttle.assertAllowed("ADMIN", null)).toThrow(
      TooManyLoginAttemptsError,
    );
  });

  it("does not block other usernames", () => {
    const throttle = new LoginThrottle({ maxFailuresPerUsername: 1 });

    throttle.recordFailure("admin", null);

    expect(() => throttle.assertAllowed("anna", null)).not.toThrow();
  });

  it("rejects attempts once the address limit is reached", () => {
    const throttle = new LoginThrottle({ maxFailuresPerAddress: 2 });

    throttle.recordFailure("first", "203.0.113.7");
    throttle.recordFailure("second", "203.0.113.7");

    expect(() => throttle.assertAllowed("third", "203.0.113.7")).toThrow(
      TooManyLoginAttemptsError,
    );
    expect(() => throttle.assertAllowed("third", "198.51.100.9")).not.toThrow();
    expect(() => throttle.assertAllowed("third", null)).not.toThrow();
  });

  it("reports how long to wait until the oldest failure expires", () => {
    const clock = createClock();
    const throttle = new LoginThrottle({
      maxFailuresPerUsername: 2,
      now: clock.now,
      windowMs: 60_000,
    });

    throttle.recordFailure("admin", null);
    clock.advance(20_000);
    throttle.recordFailure("admin", null);

    const failure = captureFailure(() => throttle.assertAllowed("admin", null));

    expect(failure.retryAfterSeconds).toBe(40);
  });

  it("allows attempts again after the window passed", () => {
    const clock = createClock();
    const throttle = new LoginThrottle({
      maxFailuresPerUsername: 2,
      now: clock.now,
      windowMs: 60_000,
    });

    throttle.recordFailure("admin", null);
    throttle.recordFailure("admin", null);
    clock.advance(60_001);

    expect(() => throttle.assertAllowed("admin", null)).not.toThrow();
  });

  it("forgets the failures of a username after a success", () => {
    const throttle = new LoginThrottle({ maxFailuresPerUsername: 2 });

    throttle.recordFailure("admin", null);
    throttle.recordFailure("admin", null);
    throttle.recordSuccess("admin");

    expect(() => throttle.assertAllowed("admin", null)).not.toThrow();
  });

  it("bounds the number of tracked keys", () => {
    const throttle = new LoginThrottle({
      maxFailuresPerUsername: 1,
      maxTrackedKeys: 2,
    });

    throttle.recordFailure("first", null);
    throttle.recordFailure("second", null);
    throttle.recordFailure("third", null);

    expect(() => throttle.assertAllowed("first", null)).not.toThrow();
    expect(() => throttle.assertAllowed("third", null)).toThrow(
      TooManyLoginAttemptsError,
    );
  });
});

function captureFailure(action: () => void): TooManyLoginAttemptsError {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof TooManyLoginAttemptsError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the action to throw.");
}
