import { expect, it, vi } from "vitest";

import { ServerCache, stableIdKey } from "./ServerCache";

const callbacks = vi.hoisted((): Array<() => Promise<void>> => []);
vi.mock("@/backend/database/CallTransaction", () => ({
  keepForCallCommit: (callback: () => Promise<void>) =>
    callbacks.push(callback),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

it("tracks cache access, invalidations and commit callbacks", async () => {
  callbacks.length = 0;
  const cache = new ServerCache();
  expect(stableIdKey(["b", "a"])).toBe("a,b");
  expect(cache.get("project:1")).toBeUndefined();
  cache.set("project:1", { value: 1 }, 10000);
  expect(cache.get("project:1")).toEqual({ value: 1 });
  cache.invalidateExact("project:1");
  cache.set("project:1", { value: 2 }, 10000);
  await callbacks[0]?.();
  expect(cache.get("project:1")).toBeUndefined();
  cache.invalidateExact("missing");
  cache.invalidatePrefix();
  expect(cache.readStats()).toEqual({
    entries: 0,
    hits: 1,
    misses: 2,
    invalidations: 2,
  });
});

it("invalidates only the documented groups, including on commit", async () => {
  callbacks.length = 0;
  const cache = new ServerCache();
  const groups = [
    "project:1",
    "projects:list:1",
    "assignees:1",
    "workitems:1",
    "labels:1",
    "users:1",
    "github:1",
    "other:1",
  ];
  for (const key of groups) cache.set(key, { key }, 10000);
  cache.invalidateProject("1");
  cache.invalidateProjectsList();
  cache.invalidateProjectMembership();
  cache.invalidateWorkItems();
  cache.invalidateLabels();
  cache.invalidateAssignees();
  cache.invalidateUsers();
  cache.invalidateGitHub();
  cache.set("github:2", {}, 10000);
  for (const callback of callbacks) await callback();
  expect(cache.get("github:2")).toBeUndefined();
  expect(cache.get("other:1")).toEqual({ key: "other:1" });
  expect(cache.readStats().invalidations).toBe(8);
});

it("honors disabled mode and size quotas even for unusual values", () => {
  const disabled = ServerCache.disabled();
  disabled.set("key", {}, 1000);
  disabled.invalidateExact("key");
  disabled.invalidatePrefix("key");
  expect(disabled.get("key")).toBeUndefined();
  expect(disabled.readStats()).toEqual({
    entries: 0,
    hits: 0,
    misses: 0,
    invalidations: 0,
  });
  const cache = new ServerCache({ maxBytes: 1024, maxEntries: 3 });
  const circular: { self?: object } = {};
  circular.self = circular;
  cache.set("circular", circular, 1000);
  expect(cache.get("circular")).toBe(circular);
  cache.set("undefined", { toJSON: () => undefined }, 1000);
  expect(cache.get("undefined")).toBeDefined();
  const small = new ServerCache({ maxBytes: 20 });
  small.set("key", { text: "€€€€" }, 1000);
  expect(small.get("key")).toBeUndefined();
});
