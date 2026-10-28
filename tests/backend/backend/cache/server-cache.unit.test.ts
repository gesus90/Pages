import { describe, expect, it, vi } from "vitest";

import { ServerCache, stableIdKey } from "@/backend/cache/ServerCache";
import { workItemScopeKey } from "@/backend/cache/WorkItemScopeKey";

describe("ServerCache", () => {
  it("returns stored values and counts hits and misses", () => {
    const cache = new ServerCache();
    cache.set("project:1", { name: "Alpha" }, 1_000);

    expect(cache.get("project:1")).toEqual({ name: "Alpha" });
    expect(cache.get("project:2")).toBeUndefined();
    expect(cache.readStats()).toEqual({
      entries: 1,
      hits: 1,
      invalidations: 0,
      misses: 1,
    });
  });

  it("expires entries after their time to live", async () => {
    // The LRU cache measures time with the monotonic clock and caches a
    // reading for one timer tick, so the test lets a tick pass per reading.
    const tick = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, 5));
    const clock = vi.spyOn(performance, "now").mockReturnValue(10_000);
    const cache = new ServerCache();
    cache.set("users:list", { rows: [] }, 1_000);
    await tick();
    clock.mockReturnValue(10_900);

    expect(cache.get("users:list")).toEqual({ rows: [] });

    await tick();
    clock.mockReturnValue(11_001);

    expect(cache.get("users:list")).toBeUndefined();
  });

  it("invalidates exactly one key and counts only real removals", () => {
    const cache = new ServerCache();
    cache.set("a", { value: 1 }, 1_000);
    cache.set("ab", { value: 2 }, 1_000);

    cache.invalidateExact("a");
    cache.invalidateExact("missing");

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("ab")).toEqual({ value: 2 });
    expect(cache.readStats().invalidations).toBe(1);
  });

  it("invalidates every key below the given prefixes only", () => {
    const cache = new ServerCache();
    cache.set("projects:list:u1", { rows: [] }, 1_000);
    cache.set("projects:list:u2", { rows: [] }, 1_000);
    cache.set("assignees:p1", { rows: [] }, 1_000);
    cache.set("labels:p1", { rows: [] }, 1_000);

    cache.invalidateProjectMembership();

    expect(cache.get("projects:list:u1")).toBeUndefined();
    expect(cache.get("assignees:p1")).toBeUndefined();
    expect(cache.get("labels:p1")).toEqual({ rows: [] });
    expect(cache.readStats().invalidations).toBe(3);

    cache.invalidatePrefix();
    expect(cache.get("labels:p1")).toEqual({ rows: [] });
  });

  it.each([
    ["invalidateProject", ["project:1", "projects:list:a"]],
    ["invalidateProjectsList", ["projects:list:a"]],
    ["invalidateWorkItems", ["workitems:a"]],
    ["invalidateLabels", ["labels:a"]],
    ["invalidateAssignees", ["assignees:a"]],
    ["invalidateUsers", ["users:a", "assignees:a"]],
    ["invalidateGitHub", ["github:a"]],
  ] as const)("%s removes its groups", (method, removedKeys) => {
    const cache = new ServerCache();
    const keys = [
      "project:1",
      "projects:list:a",
      "workitems:a",
      "labels:a",
      "assignees:a",
      "users:a",
      "github:a",
    ];
    for (const key of keys) cache.set(key, { key }, 1_000);

    if (method === "invalidateProject") cache.invalidateProject("1");
    else cache[method]();

    for (const key of keys) {
      expect(cache.get(key) === undefined).toBe(
        removedKeys.some((removed) => removed === key),
      );
    }
  });
});

describe("ServerCache limits and switches", () => {
  it("evicts when the byte quota is exceeded", () => {
    const cache = new ServerCache({ maxBytes: 100 });
    cache.set("big", { text: "x".repeat(500) }, 1_000);

    expect(cache.get("big")).toBeUndefined();
  });

  it("stores nothing and counts nothing when disabled", () => {
    const cache = ServerCache.disabled();
    cache.set("a", { value: 1 }, 1_000);
    cache.invalidatePrefix("a");
    cache.invalidateExact("a");

    expect(cache.get("a")).toBeUndefined();
    expect(cache.readStats()).toEqual({
      entries: 0,
      hits: 0,
      invalidations: 0,
      misses: 0,
    });
  });

  it("keeps raw cache keys out of the console with either legacy debug option", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const quiet = new ServerCache({ debug: false });
    quiet.set("a", { value: 1 }, 1_000);
    quiet.get("a");
    expect(debug).not.toHaveBeenCalled();

    const verbose = new ServerCache({ debug: true });
    verbose.set("a", { value: 1 }, 1_000);
    verbose.get("a");
    verbose.get("b");
    verbose.invalidateExact("a");

    expect(debug).not.toHaveBeenCalled();
    expect(verbose.readStats()).toEqual({
      entries: 0,
      hits: 1,
      invalidations: 1,
      misses: 1,
    });
  });

  it("copes with values that cannot be serialized for the size estimate", () => {
    const cache = new ServerCache();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    cache.set("circular", circular, 1_000);

    expect(cache.get("circular")).toBe(circular);
  });

  it("stores values that have no JSON form, such as functions", () => {
    const cache = new ServerCache();
    const compute = (): number => 1;
    cache.set("function", compute, 1_000);

    expect(cache.get("function")).toBe(compute);
    expect(cache.readStats().entries).toBe(1);
  });
});

describe("cache keys", () => {
  it("joins identifiers independent of their order", () => {
    expect(stableIdKey(["b", "a", "c"])).toBe("a,b,c");
    expect(stableIdKey([])).toBe("");
  });

  it("builds a scope key from actor and normalized visibility", () => {
    const scope = workItemScopeKey("u1", {
      departmentIds: ["d2", "d1", "d1"],
      projectIds: ["p2", "p1"],
    });

    expect(scope).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      workItemScopeKey("u1", {
        departmentIds: ["d1", "d2"],
        projectIds: ["p1", "p2", "p2"],
      }),
    ).toBe(scope);
  });

  it("separates actors and distinguishes an empty from an unlimited scope", () => {
    const empty = workItemScopeKey("u1", { departmentIds: [], projectIds: [] });
    const unlimited = workItemScopeKey("u1", { departmentIds: null });

    expect(empty).not.toBe(unlimited);
    expect(
      workItemScopeKey("u2", { departmentIds: [], projectIds: [] }),
    ).not.toBe(empty);
    expect(workItemScopeKey("u1", { departmentIds: ["a,b"] })).not.toBe(
      workItemScopeKey("u1", { departmentIds: ["a", "b"] }),
    );
  });
});
