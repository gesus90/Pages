import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PairingThrottle } from "@/backend/service/mcp/PairingThrottle";

const address = { socket: "127.0.0.1", forwarded: null };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

it("enforces the minute boundary using the socket even when the forwarded key changes", () => {
  const throttle = new PairingThrottle();
  for (let index = 0; index < 5; index++) {
    throttle.request({ ...address, forwarded: `proxy-${index}` });
  }
  expect(() =>
    throttle.request({ ...address, forwarded: "another-proxy" }),
  ).toThrow(
    expect.objectContaining({ code: "slow_down", status: 429, retryAfter: 60 }),
  );
  vi.setSystemTime(Date.now() + 60_000);
  expect(() => throttle.request(address)).not.toThrow();
});

it("enforces the hourly limit independently of request bursts and releases it at the boundary", () => {
  const throttle = new PairingThrottle();
  const startedAt = Date.now();
  for (let index = 0; index < 20; index++) {
    throttle.request(address);
    vi.setSystemTime(Date.now() + 60_000);
  }
  expect(() => throttle.request(address)).toThrow(
    expect.objectContaining({ retryAfter: 3600 }),
  );
  vi.setSystemTime(startedAt + 3_600_000);
  expect(() => throttle.request(address)).not.toThrow();
});

it("limits open requests, extends a late approval and releases ended or expired requests", () => {
  const throttle = new PairingThrottle();
  const deadline = Date.now() + 600_000;
  for (let index = 0; index < 10; index++) {
    throttle.started(`request-${index}`, address, deadline);
  }
  expect(() => throttle.request(address)).toThrow(
    expect.objectContaining({ retryAfter: 600 }),
  );
  throttle.approved("request-0", deadline + 60_000);
  throttle.approved("request-0", deadline - 60_000);
  throttle.approved("unknown", deadline);
  throttle.ended("request-1");
  expect(() => throttle.request(address)).not.toThrow();
  vi.setSystemTime(deadline);
  for (let index = 1; index < 10; index++) {
    throttle.started(`new-${index}`, address, deadline + 120_000);
  }
  expect(() => throttle.request(address)).toThrow(
    expect.objectContaining({ retryAfter: 600 }),
  );
  vi.setSystemTime(deadline + 60_000);
  expect(() => throttle.request(address)).not.toThrow();
});

it("uses the forwarded address only as an additional limit key", () => {
  const throttle = new PairingThrottle();
  const forwarded = "p".repeat(201);
  for (let index = 0; index < 5; index++) {
    throttle.request({ socket: `socket-${index}`, forwarded });
  }
  expect(() =>
    throttle.request({ socket: "fresh", forwarded: `${"p".repeat(200)}x` }),
  ).toThrow(expect.objectContaining({ retryAfter: 60 }));
  expect(() =>
    throttle.request({ socket: "fresh", forwarded: null }),
  ).not.toThrow();
});

it("locks failed code lookups per user and socket and reports the remaining whole seconds", () => {
  const throttle = new PairingThrottle();
  for (let index = 0; index < 10; index++) {
    throttle.browser("owner", address, true);
  }
  expect(() =>
    throttle.browser("owner", { socket: "other", forwarded: null }),
  ).toThrow(expect.objectContaining({ retryAfter: 900 }));
  expect(() => throttle.browser("other", address)).toThrow(
    expect.objectContaining({ retryAfter: 900 }),
  );
  expect(() =>
    throttle.browser("other", { socket: "other", forwarded: null }),
  ).not.toThrow();
  vi.setSystemTime(Date.now() + 1501);
  expect(() => throttle.browser("owner", address)).toThrow(
    expect.objectContaining({ retryAfter: 899 }),
  );
  vi.setSystemTime(Date.now() + 898_499);
  expect(() => throttle.browser("owner", address)).not.toThrow();
});

it("expires old failure attempts before they can accumulate into a lock", () => {
  const throttle = new PairingThrottle();
  for (let index = 0; index < 9; index++) {
    throttle.browser("owner", address, true);
  }
  vi.setSystemTime(Date.now() + 900_000);
  throttle.browser("owner", address, true);
  expect(() => throttle.browser("owner", address)).not.toThrow();
});

it("bounds stored address keys and reclaims them after the request retention period", () => {
  const throttle = new PairingThrottle();
  for (let index = 0; index <= 10_000; index++) {
    throttle.request({ socket: `socket-${index}`, forwarded: null });
  }
  expect(() => throttle.request(address)).toThrow(
    expect.objectContaining({ retryAfter: 900 }),
  );
  vi.setSystemTime(Date.now() + 3_600_000);
  expect(() => throttle.request(address)).not.toThrow();
});
