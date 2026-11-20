import { afterEach, expect, it, vi } from "vitest";

import { LoginThrottle, TooManyLoginAttemptsError } from "./LoginThrottle";

const WINDOW_MS = 100_000;

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }

  return undefined;
}

afterEach(() => {
  vi.useRealTimers();
});

it("blocks a username after its limit and reports when the oldest counted failure leaves the window", () => {
  let now = 0;
  const throttle = new LoginThrottle({
    now: () => now,
    windowMs: WINDOW_MS,
    maxFailuresPerUsername: 2,
  });
  throttle.recordFailure("alice", null);
  now = 10_000;
  throttle.recordFailure("alice", null);

  const error = captureError(() => {
    throttle.assertAllowed("alice", null);
  });

  expect(error).toBeInstanceOf(TooManyLoginAttemptsError);
  expect(error).toMatchObject({
    name: "TooManyLoginAttemptsError",
    retryAfterSeconds: 90,
  });
});

it("allows the username again once the window has passed", () => {
  let now = 0;
  const throttle = new LoginThrottle({
    now: () => now,
    windowMs: WINDOW_MS,
    maxFailuresPerUsername: 1,
  });
  throttle.recordFailure("alice", null);
  now = WINDOW_MS + 1;

  expect(() => {
    throttle.assertAllowed("alice", null);
  }).not.toThrow();
});

it("treats usernames case-insensitively and ignores surrounding whitespace", () => {
  const throttle = new LoginThrottle({ maxFailuresPerUsername: 1 });
  throttle.recordFailure(" Alice ", null);

  expect(() => {
    throttle.assertAllowed("alice", null);
  }).toThrow(TooManyLoginAttemptsError);
});

it("forgets the failures of a username after a successful login", () => {
  const throttle = new LoginThrottle({ maxFailuresPerUsername: 1 });
  throttle.recordFailure("alice", null);
  throttle.recordSuccess("alice");

  expect(() => {
    throttle.assertAllowed("alice", null);
  }).not.toThrow();
});

it("blocks a client address across different usernames", () => {
  const throttle = new LoginThrottle({ maxFailuresPerAddress: 2 });
  throttle.recordFailure("first", "10.0.0.1");
  throttle.recordFailure("second", "10.0.0.1");

  expect(() => {
    throttle.assertAllowed("third", "10.0.0.1");
  }).toThrow(TooManyLoginAttemptsError);
  expect(() => {
    throttle.assertAllowed("third", "10.0.0.2");
  }).not.toThrow();
  expect(() => {
    throttle.assertAllowed("third", null);
  }).not.toThrow();
});

it("counts a failure without a known address only against the username", () => {
  const throttle = new LoginThrottle({
    maxFailuresPerAddress: 1,
    maxFailuresPerUsername: 5,
  });
  throttle.recordFailure("first", null);
  throttle.recordFailure("second", undefined);
  throttle.recordFailure("third", "");

  expect(() => {
    throttle.assertAllowed("fourth", "10.0.0.1");
  }).not.toThrow();
});

it("reports the longer wait when the username and the address are both blocked", () => {
  let now = 0;
  const throttle = new LoginThrottle({
    now: () => now,
    windowMs: WINDOW_MS,
    maxFailuresPerUsername: 1,
    maxFailuresPerAddress: 1,
  });
  throttle.recordFailure("alice", "10.0.0.1");
  now = 40_000;
  throttle.recordFailure("bob", "10.0.0.2");

  const error = captureError(() => {
    throttle.assertAllowed("alice", "10.0.0.2");
  });

  expect(error).toMatchObject({ retryAfterSeconds: 100 });
});

it("waits for the earliest of the most recent failures when more than the limit were recorded", () => {
  let now = 0;
  const throttle = new LoginThrottle({
    now: () => now,
    windowMs: WINDOW_MS,
    maxFailuresPerUsername: 2,
  });
  throttle.recordFailure("alice", null);
  now = 10_000;
  throttle.recordFailure("alice", null);
  now = 20_000;
  throttle.recordFailure("alice", null);
  now = 30_000;

  const error = captureError(() => {
    throttle.assertAllowed("alice", null);
  });

  expect(error).toMatchObject({ retryAfterSeconds: 80 });
});

it("drops failures that left the sliding window before counting", () => {
  let now = 0;
  const throttle = new LoginThrottle({
    now: () => now,
    windowMs: WINDOW_MS,
    maxFailuresPerUsername: 2,
  });
  throttle.recordFailure("alice", null);
  now = 10_000;
  throttle.recordFailure("alice", null);
  now = WINDOW_MS + 1;

  expect(() => {
    throttle.assertAllowed("alice", null);
  }).not.toThrow();
});

it("evicts the oldest tracked keys beyond the configured capacity", () => {
  const throttle = new LoginThrottle({
    maxTrackedKeys: 2,
    maxFailuresPerUsername: 1,
  });
  throttle.recordFailure("alice", null);
  throttle.recordFailure("bob", null);
  throttle.recordFailure("carol", null);

  expect(() => {
    throttle.assertAllowed("alice", null);
  }).not.toThrow();
  expect(() => {
    throttle.assertAllowed("carol", null);
  }).toThrow(TooManyLoginAttemptsError);
});

it("uses the system clock and the default limits when no options are given", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(0));
  const throttle = new LoginThrottle();

  for (let attempt = 0; attempt < 9; attempt += 1) {
    throttle.recordFailure("alice", null);
  }
  expect(() => {
    throttle.assertAllowed("alice", null);
  }).not.toThrow();

  throttle.recordFailure("alice", null);
  const error = captureError(() => {
    throttle.assertAllowed("alice", null);
  });

  expect(error).toMatchObject({ retryAfterSeconds: 900 });
});

it("applies the default address limit of thirty failures", () => {
  const throttle = new LoginThrottle();

  for (let attempt = 0; attempt < 30; attempt += 1) {
    throttle.recordFailure(`user-${attempt}`, "10.0.0.9");
  }

  expect(() => {
    throttle.assertAllowed("someone-else", "10.0.0.9");
  }).toThrow(TooManyLoginAttemptsError);
});

it("uses the default fifteen-minute window when the system clock is used", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(0));
  const throttle = new LoginThrottle({ maxFailuresPerUsername: 1 });
  throttle.recordFailure("alice", null);
  vi.setSystemTime(new Date(15 * 60 * 1000 + 1));

  expect(() => {
    throttle.assertAllowed("alice", null);
  }).not.toThrow();
});
