import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  DRAFT_ROUTE_PREFIX,
  LocalStateStore,
  localState,
} from "@/app/lib/local-state/local-state-store";

import { FakeBroadcastChannel, FakeIndexedDb } from "./browser-fakes";

import type { LocalStateKind } from "@/app/lib/local-state/local-state-store";

interface Page {
  readonly title: string;
}

const NOW = 1_700_000_000_000;
const ENTRIES = "entries";
const META = "meta";

const PAGE_KIND: LocalStateKind<Page> = {
  schemaVersion: 2,
  isPayload: (value): value is Page =>
    typeof value === "object" &&
    value !== null &&
    "title" in value &&
    typeof value.title === "string",
};

let factory: FakeIndexedDb;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  factory = new FakeIndexedDb();
  FakeBroadcastChannel.reset();
  vi.stubGlobal("indexedDB", factory);
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function entryKey(ownerId: string, route: string): string {
  return JSON.stringify([ownerId, route]);
}

function storedRoutes(): string[] {
  return [...factory.records(ENTRIES).keys()].sort();
}

async function claimedStore(ownerId: string | null): Promise<LocalStateStore> {
  const store = new LocalStateStore();
  await store.claim(ownerId);
  return store;
}

function rawEntry(
  ownerId: string,
  route: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ownerId,
    route,
    schemaVersion: PAGE_KIND.schemaVersion,
    savedAt: NOW,
    payload: { title: "raw" },
    ...overrides,
  };
}

it("exports one shared store of the tab", () => {
  expect(localState).toBeInstanceOf(LocalStateStore);
  expect(DRAFT_ROUTE_PREFIX).toBe("draft:");
});

it("keeps an answer for the claimed account and reads it back", async () => {
  const store = await claimedStore("alice");

  await store.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });

  expect(await store.read("/wiki/a", PAGE_KIND)).toEqual({
    ownerId: "alice",
    route: "/wiki/a",
    schemaVersion: 2,
    savedAt: NOW,
    payload: { title: "A" },
  });
  expect(store.currentOwner()).toBe("alice");
  expect(await store.recordedOwner()).toBe("alice");
});

it("reads nothing before an account is claimed or while none is signed in", async () => {
  const unclaimed = new LocalStateStore();
  expect(await unclaimed.read("/wiki/a", PAGE_KIND)).toBeNull();
  expect(unclaimed.currentOwner()).toBeNull();

  const signedOut = await claimedStore(null);
  expect(await signedOut.read("/wiki/a", PAGE_KIND)).toBeNull();
  expect(signedOut.currentOwner()).toBeNull();
});

it("finds no answer for a route that was never saved", async () => {
  const store = await claimedStore("alice");

  expect(await store.read("/wiki/none", PAGE_KIND)).toBeNull();
});

it("discards a kept answer of another schema version", async () => {
  const store = await claimedStore("alice");
  factory.seed(ENTRIES, rawEntry("alice", "/old", { schemaVersion: 1 }));

  expect(await store.read("/old", PAGE_KIND)).toBeNull();
  expect(storedRoutes()).toEqual([]);
});

it("discards a kept answer whose payload has the wrong shape", async () => {
  const store = await claimedStore("alice");
  factory.seed(ENTRIES, rawEntry("alice", "/bad", { payload: { title: 3 } }));

  expect(await store.read("/bad", PAGE_KIND)).toBeNull();
  expect(storedRoutes()).toEqual([]);
});

it.each([
  {
    label: "a record without the entry fields",
    junk: { ownerId: "alice", route: "/junk" },
  },
  {
    label: "a record with a numeric owner",
    junk: rawEntry("alice", "/junk", { ownerId: 1 }),
  },
  {
    label: "a record with a numeric route",
    junk: rawEntry("alice", "/junk", { route: 1 }),
  },
  {
    label: "a record with a textual version",
    junk: rawEntry("alice", "/junk", { schemaVersion: "2" }),
  },
  {
    label: "a record without a time",
    junk: rawEntry("alice", "/junk", { savedAt: "now" }),
  },
  {
    label: "a record without a payload",
    junk: { ownerId: "alice", route: "/junk", schemaVersion: 2, savedAt: NOW },
  },
  { label: "a text instead of a record", junk: "junk" },
  { label: "a null instead of a record", junk: null },
])("discards $label", async ({ junk }) => {
  const store = await claimedStore("alice");
  factory.seed(ENTRIES, junk, ["alice", "/junk"]);

  expect(await store.read("/junk", PAGE_KIND)).toBeNull();
  expect(storedRoutes()).toEqual([]);
});

it("does not show an answer once another account was recorded", async () => {
  const alice = await claimedStore("alice");
  await alice.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });
  const bob = new LocalStateStore();
  await bob.claim("bob");
  factory.seed(ENTRIES, rawEntry("alice", "/wiki/late"));

  expect(await alice.read("/wiki/late", PAGE_KIND)).toBeNull();
  expect(storedRoutes()).toEqual([]);
});

it("does not show an answer stored under another owner's name", async () => {
  const store = await claimedStore("alice");
  factory.seed(ENTRIES, rawEntry("bob", "/wiki/a"), ["alice", "/wiki/a"]);

  expect(await store.read("/wiki/a", PAGE_KIND)).toBeNull();
  expect(storedRoutes()).toEqual([]);
});

it("empties the store when another account signs in", async () => {
  const alice = await claimedStore("alice");
  await alice.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });
  await alice.save("alice", `${DRAFT_ROUTE_PREFIX}wiki`, PAGE_KIND, {
    title: "draft",
  });

  const bob = new LocalStateStore();
  await bob.claim("bob");

  expect(storedRoutes()).toEqual([]);
  expect(await bob.recordedOwner()).toBe("bob");
});

it("keeps what the same account already holds on a repeated claim", async () => {
  const store = await claimedStore("alice");
  await store.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });

  await store.claim("alice");

  expect(storedRoutes()).toEqual([entryKey("alice", "/wiki/a")]);
});

it("drops answers but keeps an account's drafts when the session lapses without sign-out", async () => {
  const store = await claimedStore("alice");
  await store.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });
  await store.save("alice", `${DRAFT_ROUTE_PREFIX}wiki`, PAGE_KIND, {
    title: "draft",
  });

  await store.claim(null);

  expect(storedRoutes()).toEqual([
    entryKey("alice", `${DRAFT_ROUTE_PREFIX}wiki`),
  ]);
  expect(await store.recordedOwner()).toBeNull();
});

it("drops drafts of the account on a sign-out", async () => {
  const store = await claimedStore("alice");
  await store.save("alice", `${DRAFT_ROUTE_PREFIX}wiki`, PAGE_KIND, {
    title: "draft",
  });

  await store.claim("alice", { isSignOut: true });

  expect(storedRoutes()).toEqual([]);
});

it("treats an entry with a non-text route as no draft", async () => {
  const store = await claimedStore("alice");
  factory.seed(ENTRIES, rawEntry("alice", "x", { route: 5 }));

  await store.claim(null);

  expect(storedRoutes()).toEqual([]);
});

it("applies answers requested before the claim once the account is named", async () => {
  const store = new LocalStateStore();
  await store.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });
  await store.save("alice", "/wiki/b", PAGE_KIND, { title: "B" });
  await store.save("bob", "/wiki/c", PAGE_KIND, { title: "C" });
  await store.remove("/wiki/b");

  await store.claim("alice");

  expect(storedRoutes()).toEqual([entryKey("alice", "/wiki/a")]);
  expect((await store.read("/wiki/a", PAGE_KIND))?.payload).toEqual({
    title: "A",
  });
});

it("removes an earlier answer that a removal requested before the claim names", async () => {
  const first = await claimedStore("alice");
  await first.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });
  const reloaded = new LocalStateStore();
  await reloaded.remove("/wiki/a");

  await reloaded.claim("alice");

  expect(storedRoutes()).toEqual([]);
});

it("applies nothing that waited when the claim names no account", async () => {
  const store = new LocalStateStore();
  await store.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });

  await store.claim(null);

  expect(storedRoutes()).toEqual([]);
});

it("refuses to keep an answer of another account than the claimed one", async () => {
  const store = await claimedStore("alice");

  await store.save("bob", "/wiki/a", PAGE_KIND, { title: "late" });

  expect(storedRoutes()).toEqual([]);
});

it("refuses a late answer when another tab recorded a different account", async () => {
  const store = await claimedStore("alice");
  const other = new LocalStateStore();
  await other.claim("bob");

  await store.save("alice", "/wiki/late", PAGE_KIND, { title: "late" });

  expect(storedRoutes()).toEqual([]);
});

it("removes the answer of the claimed account for a route", async () => {
  const store = await claimedStore("alice");
  await store.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });
  await store.save("alice", "/wiki/b", PAGE_KIND, { title: "B" });

  await store.remove("/wiki/a");

  expect(storedRoutes()).toEqual([entryKey("alice", "/wiki/b")]);
});

it("removes nothing while no account is signed in", async () => {
  const store = await claimedStore(null);
  factory.seed(ENTRIES, rawEntry("alice", "/wiki/a"));

  await store.remove("/wiki/a");

  expect(storedRoutes()).toEqual([entryKey("alice", "/wiki/a")]);
});

it("removes only the outdated answers of the claimed account", async () => {
  const store = await claimedStore("alice");
  await store.save("alice", "/wiki/old", PAGE_KIND, { title: "old" });
  await store.save("alice", "/wiki/new", PAGE_KIND, { title: "new" });
  await store.save("alice", `${DRAFT_ROUTE_PREFIX}wiki`, PAGE_KIND, {
    title: "old",
  });
  factory.seed(ENTRIES, rawEntry("bob", "/wiki/old", { payload: "old" }));
  factory.seed(ENTRIES, "junk", ["alice", "/junk"]);

  await store.removeOutdated(
    (payload) =>
      typeof payload === "object" &&
      payload !== null &&
      "title" in payload &&
      payload.title === "old",
  );

  expect(storedRoutes()).toEqual([
    entryKey("alice", "/junk"),
    entryKey("alice", "/wiki/new"),
    entryKey("alice", `${DRAFT_ROUTE_PREFIX}wiki`),
    entryKey("bob", "/wiki/old"),
  ]);
});

it("removes no outdated answer without a signed-in account", async () => {
  const store = await claimedStore(null);
  factory.seed(ENTRIES, rawEntry("alice", "/wiki/a"));
  const isOutdated = vi.fn(() => true);

  await store.removeOutdated(isOutdated);

  expect(isOutdated).not.toHaveBeenCalled();
  expect(storedRoutes()).toEqual([entryKey("alice", "/wiki/a")]);
});

it("reports no recorded owner for a browser that never kept anything", async () => {
  const store = new LocalStateStore();

  expect(await store.recordedOwner()).toBeNull();
  expect(factory.records(META).size).toBe(0);
});

it("reports a recorded owner of an earlier document", async () => {
  await claimedStore("alice");

  expect(await new LocalStateStore().recordedOwner()).toBe("alice");
});

it("lets waiting work go on once the document names its account", async () => {
  const store = new LocalStateStore();
  const settled = vi.fn();
  void store.whenClaimed().then(settled);
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();

  await store.claim("alice");
  await store.whenClaimed();

  expect(settled).toHaveBeenCalledTimes(1);
});

it("lets waiting work go on without a claim for a document without account", async () => {
  const store = new LocalStateStore();

  store.settleWithoutClaim();

  await expect(store.whenClaimed()).resolves.toBeUndefined();
  expect(store.currentOwner()).toBeNull();
});

it("keeps nothing in a browser without IndexedDB", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const store = new LocalStateStore();

  await store.claim("alice");
  await store.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });

  expect(await store.read("/wiki/a", PAGE_KIND)).toBeNull();
  expect(await store.recordedOwner()).toBeNull();
  expect(factory.openCount).toBe(0);
  expect(warn).not.toHaveBeenCalled();
});

it.each([
  ["entries", ["ownerId", "route"]],
  ["meta", null],
] as const)(
  "completes an interrupted upgrade that only created the %s store",
  async (name, keyPath) => {
    factory.createStore(name, keyPath);
    const store = await claimedStore("alice");

    await store.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });

    expect((await store.read("/wiki/a", PAGE_KIND))?.payload).toEqual({
      title: "A",
    });
    expect(await store.recordedOwner()).toBe("alice");
  },
);

it("works without a broadcast channel and never supersedes", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  const store = await claimedStore("alice");

  await store.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });

  expect(FakeBroadcastChannel.instances).toHaveLength(0);
  expect(store.isSuperseded()).toBe(false);
  expect(store.supersessionState()).toBe("current");
});

it("opens the database again after a failed attempt", async () => {
  const store = new LocalStateStore();
  factory.failNext("open", new Error("blocked"));

  expect(await store.recordedOwner()).toBeNull();
  expect(warn).toHaveBeenCalledWith(
    "Pages could not use the local data of this browser.",
    new Error("blocked"),
  );

  await store.claim("alice");
  expect(await store.recordedOwner()).toBe("alice");
  expect(factory.openCount).toBe(2);
});

it("answers the fallback when a request fails without an error", async () => {
  const store = new LocalStateStore();
  await store.claim("alice");
  factory.failNext("request", null);

  expect(await store.recordedOwner()).toBeNull();
  expect(warn).toHaveBeenCalledWith(
    "Pages could not use the local data of this browser.",
    new Error("IndexedDB"),
  );
});

it("answers the fallback when a request fails with its own error", async () => {
  const store = await claimedStore("alice");
  factory.failNext("request", new Error("quota"));

  expect(await store.read("/wiki/a", PAGE_KIND)).toBeNull();
  expect(warn).toHaveBeenCalledWith(
    "Pages could not use the local data of this browser.",
    new Error("quota"),
  );
});

it("answers the fallback when a transaction is aborted", async () => {
  const store = await claimedStore("alice");
  factory.failNext("abort", new Error("aborted by browser"));

  expect(await store.recordedOwner()).toBeNull();
  expect(warn).toHaveBeenCalledWith(
    "Pages could not use the local data of this browser.",
    new Error("aborted by browser"),
  );
});

it("names an aborted transaction even when the browser gives no reason", async () => {
  const store = await claimedStore("alice");
  factory.failNext("abort", null);

  expect(await store.recordedOwner()).toBeNull();
  expect(warn).toHaveBeenCalledWith(
    "Pages could not use the local data of this browser.",
    new Error("IndexedDB transaction aborted"),
  );
});

it("names a failed transaction with or without the browser's reason", async () => {
  const store = await claimedStore("alice");
  factory.failNext("transactionError", new Error("disk"));
  expect(await store.recordedOwner()).toBeNull();
  factory.failNext("transactionError", null);
  expect(await store.recordedOwner()).toBeNull();

  expect(warn).toHaveBeenNthCalledWith(
    1,
    "Pages could not use the local data of this browser.",
    new Error("disk"),
  );
  expect(warn).toHaveBeenNthCalledWith(
    2,
    "Pages could not use the local data of this browser.",
    new Error("IndexedDB transaction failed"),
  );
});

it("reopens the database after another tab upgraded its schema", async () => {
  const store = await claimedStore("alice");
  const first = factory.lastDatabase;

  first?.onversionchange?.();
  expect(first?.isClosed).toBe(true);

  expect(await store.recordedOwner()).toBe("alice");
  expect(factory.openCount).toBe(2);
  expect(factory.lastDatabase).not.toBe(first);
});

it("keeps working after earlier work in the queue failed", async () => {
  const store = await claimedStore("alice");
  factory.failNext("request", new Error("once"));
  const failed = store.save("alice", "/wiki/a", PAGE_KIND, { title: "A" });
  const later = store.save("alice", "/wiki/b", PAGE_KIND, { title: "B" });

  await Promise.all([failed, later]);

  expect(storedRoutes()).toEqual([entryKey("alice", "/wiki/b")]);
});

function broadcastFrom(notice: unknown): void {
  new FakeBroadcastChannel("pages-local-state-claims").postMessage(notice);
}

it("supersedes a tab when another tab claims another account", async () => {
  const tab = await claimedStore("alice");
  const listener = vi.fn();
  tab.onSuperseded(listener);

  await new LocalStateStore().claim("bob");

  expect(tab.isSuperseded()).toBe(true);
  expect(tab.supersessionState()).toBe("settled");
  expect(listener).toHaveBeenCalledTimes(1);
});

it("does not supersede a tab when another tab claims the same account", async () => {
  const tab = await claimedStore("alice");
  const listener = vi.fn();
  tab.onSuperseded(listener);

  await new LocalStateStore().claim("alice");

  expect(tab.supersessionState()).toBe("current");
  expect(listener).not.toHaveBeenCalled();
});

it("holds a tab pending during a sign-out and settles it with the next claim", async () => {
  const tab = await claimedStore("alice");
  const listener = vi.fn();
  tab.onSuperseded(listener);
  const other = new LocalStateStore();

  await other.claim("alice", { isSignOut: true });
  expect(tab.supersessionState()).toBe("pending");
  expect(tab.isSuperseded()).toBe(true);

  await other.claim("alice", { isSignOut: true });
  expect(tab.supersessionState()).toBe("pending");
  expect(listener).toHaveBeenCalledTimes(1);

  await other.claim(null);
  expect(tab.supersessionState()).toBe("settled");
  expect(listener).toHaveBeenCalledTimes(2);
});

it("stays settled when a later sign-out is announced", async () => {
  const tab = await claimedStore("alice");
  const listener = vi.fn();
  tab.onSuperseded(listener);
  const other = new LocalStateStore();
  await other.claim("bob");

  await other.claim("bob", { isSignOut: true });

  expect(tab.supersessionState()).toBe("settled");
  expect(listener).toHaveBeenCalledTimes(1);
});

it("becomes current again when the tab claims its account anew", async () => {
  const tab = await claimedStore("alice");
  await new LocalStateStore().claim("bob");
  expect(tab.isSuperseded()).toBe(true);

  await tab.claim("alice");

  expect(tab.supersessionState()).toBe("current");
});

it("stops calling a listener that was removed", async () => {
  const tab = await claimedStore("alice");
  const listener = vi.fn();
  const stop = tab.onSuperseded(listener);

  stop();
  await new LocalStateStore().claim("bob");

  expect(listener).not.toHaveBeenCalled();
  expect(tab.isSuperseded()).toBe(true);
});

it("ignores claims while the tab has no account", async () => {
  const tab = await claimedStore(null);

  await new LocalStateStore().claim("bob");

  expect(tab.supersessionState()).toBe("current");
});

it("ignores announcements that are no claims", async () => {
  const tab = await claimedStore("alice");

  broadcastFrom(null);
  broadcastFrom("bob");
  broadcastFrom({ ownerId: "bob" });
  broadcastFrom({ ownerId: 5, isSignOut: false });
  broadcastFrom({ ownerId: "bob", isSignOut: "yes" });

  expect(tab.supersessionState()).toBe("current");
});

it("accepts an announced sign-out without account", async () => {
  const tab = await claimedStore("alice");

  broadcastFrom({ ownerId: null, isSignOut: false });

  expect(tab.supersessionState()).toBe("settled");
});
