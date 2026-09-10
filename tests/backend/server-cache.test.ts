import { describe, expect, it, vi } from "vitest";

import { ServerCache, stableIdKey } from "@/backend/cache/ServerCache";

describe("ServerCache", () => {
  it("returns cached values and tracks hits and misses", () => {
    const cache = new ServerCache();

    expect(cache.get<{ readonly n: number }>("missing")).toBeUndefined();
    cache.set("answer", { n: 42 }, 60_000);

    expect(cache.get<{ readonly n: number }>("answer")).toEqual({ n: 42 });
    expect(cache.readStats()).toMatchObject({
      hits: 1,
      invalidations: 0,
      misses: 1,
    });
  });

  it("expires entries after their TTL", async () => {
    const cache = new ServerCache();
    cache.set("brief", { n: 1 }, 10);

    expect(cache.get("brief")).toEqual({ n: 1 });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(cache.get("brief")).toBeUndefined();
  });

  it("bounds the number of entries with LRU eviction", () => {
    const cache = new ServerCache({ maxEntries: 2 });
    cache.set("first", { n: 1 }, 60_000);
    cache.set("second", { n: 2 }, 60_000);
    cache.set("third", { n: 3 }, 60_000);

    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toEqual({ n: 2 });
    expect(cache.get("third")).toEqual({ n: 3 });
  });

  it("invalidates key groups without touching other groups", () => {
    const cache = new ServerCache();
    cache.set("projects:list:u:user-1", [{ id: "p1" }], 60_000);
    cache.set("project:p1", { id: "p1" }, 60_000);

    cache.invalidateProjectsList();

    expect(cache.get("projects:list:u:user-1")).toBeUndefined();
    expect(cache.get("project:p1")).toEqual({ id: "p1" });
  });

  it("removes single entries without matching identifier prefixes", () => {
    const cache = new ServerCache();
    cache.set("project:abc", { id: "abc" }, 60_000);
    cache.set("project:abcdef", { id: "abcdef" }, 60_000);

    cache.invalidateProject("abc");

    expect(cache.get("project:abc")).toBeUndefined();
    expect(cache.get("project:abcdef")).toEqual({ id: "abcdef" });
  });

  it("invalidates related groups through central helpers", () => {
    const cache = new ServerCache();
    cache.set("projects:list:u:user-1", [{ id: "p1" }], 60_000);
    cache.set("assignees:projects:p1", [{ id: "u1" }], 60_000);
    cache.set("workitems:q:all", [{ id: "w1" }], 30_000);
    cache.set("labels:projects:p1", [{ id: "l1" }], 120_000);

    cache.invalidateProjectMembership();
    cache.invalidateWorkItems();
    cache.invalidateLabels();

    expect(cache.get("projects:list:u:user-1")).toBeUndefined();
    expect(cache.get("assignees:projects:p1")).toBeUndefined();
    expect(cache.get("workitems:q:all")).toBeUndefined();
    expect(cache.get("labels:projects:p1")).toBeUndefined();
    expect(cache.readStats().invalidations).toBe(4);
  });

  it("behaves as a no-op when disabled", () => {
    const cache = ServerCache.disabled();
    cache.set("answer", { n: 42 }, 60_000);

    expect(cache.get("answer")).toBeUndefined();

    expect(() => {
      cache.invalidateProjectsList();
      cache.invalidateWorkItems();
      cache.invalidateProject("p1");
    }).not.toThrow();
  });

  it("logs cache events only with debug enabled", () => {
    const log = vi.spyOn(console, "debug").mockImplementation(() => {});
    const noisy = new ServerCache({ debug: true });
    const quiet = new ServerCache({ debug: false });

    try {
      noisy.set("answer", { n: 1 }, 60_000);
      noisy.get("answer");
      noisy.get("missing");
      quiet.set("answer", { n: 1 }, 60_000);
      quiet.get("answer");

      expect(
        log.mock.calls.filter(([message]) =>
          String(message).includes("[pages][cache]"),
        ),
      ).toHaveLength(2);
    } finally {
      log.mockRestore();
    }
  });

  it("builds order-independent identifier keys", () => {
    expect(stableIdKey(["b", "a", "c"])).toBe(stableIdKey(["c", "b", "a"]));
    expect(stableIdKey(["a"])).not.toBe(stableIdKey(["a", "b"]));
  });

  it("falls back to a fixed size when a value cannot be serialized", () => {
    const cache = new ServerCache();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    cache.set("circular", circular, 60_000);

    expect(cache.get("circular")).toEqual(circular);
  });

  it("invalidates assignee and user groups", () => {
    const cache = new ServerCache();
    cache.set("assignees:projects:p1", [{ id: "u1" }], 60_000);
    cache.set("users:list:all", [{ id: "u1" }], 120_000);
    cache.set("labels:projects:p1", [{ id: "l1" }], 120_000);

    cache.invalidateAssignees();
    cache.invalidateUsers();

    expect(cache.get("assignees:projects:p1")).toBeUndefined();
    expect(cache.get("users:list:all")).toBeUndefined();
    expect(cache.get("labels:projects:p1")).toEqual([{ id: "l1" }]);
    expect(cache.readStats().invalidations).toBe(2);
  });

  it("uses a fixed size fallback when a value stringifies to undefined", () => {
    const cache = new ServerCache();
    const value = { toJSON: () => undefined };

    cache.set("omitted", value, 60_000);

    expect(cache.get("omitted")).toEqual(value);
  });

  it("ignores invalidations for keys that are not present", () => {
    const cache = new ServerCache();

    cache.invalidateExact("missing");

    expect(cache.readStats().invalidations).toBe(0);
  });
});
