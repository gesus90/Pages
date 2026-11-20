import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type * as AccountAuthorizationModule from "./AccountAuthorizationLog";

import type { ServerLogEvent } from "./Logger";

const logs = vi.hoisted(() => {
  const state: { events: ServerLogEvent[] } = { events: [] };
  return state;
});

vi.mock("./Logger", () => ({
  logEvent: (event: ServerLogEvent) => {
    logs.events.push(event);
  },
}));

let authorization: typeof AccountAuthorizationModule;

beforeEach(async () => {
  vi.resetModules();
  authorization = await import("./AccountAuthorizationLog");
});

afterEach(() => {
  logs.events.length = 0;
});

/** Stages a version and confirms the delivery only when `delivered` is true. */
function deliver(userId: string, version: string, delivered = true): void {
  authorization.withAccountAuthorizationLog((confirm) => {
    authorization.recordAccountAuthorizationVersion(userId, version);
    if (delivered) confirm();
  });
}

function changedEventUserIds(): unknown[] {
  return logs.events
    .filter((event) => event.event === "account.authorization.changed")
    .map((event) => event.metadata?.userId);
}

it("logs nothing for the first delivered version of an account", () => {
  deliver("account-first", "v1");

  expect(changedEventUserIds()).toEqual([]);
});

it("logs one change event when a delivered account version changes", () => {
  deliver("account-change", "v1");
  deliver("account-change", "v1");
  deliver("account-change", "v2");

  expect(changedEventUserIds()).toEqual(["account-change"]);
  expect(logs.events.at(-1)).toEqual({
    level: "info",
    event: "account.authorization.changed",
    component: "AccountAuthorization",
    message: "Delivered account authorization version changed",
    metadata: { userId: "account-change" },
  });
});

it("logs a change only for a version whose delivery was confirmed", () => {
  deliver("account-unconfirmed", "v1");
  deliver("account-unconfirmed", "v2", false);
  expect(changedEventUserIds()).toEqual([]);

  deliver("account-unconfirmed", "v2");
  expect(changedEventUserIds()).toEqual(["account-unconfirmed"]);
});

it("ignores a second confirmation of the same delivery", () => {
  authorization.withAccountAuthorizationLog((confirm) => {
    authorization.recordAccountAuthorizationVersion("account-double", "v1");
    confirm();
    confirm();
  });
  authorization.withAccountAuthorizationLog((confirm) => {
    authorization.recordAccountAuthorizationVersion("account-double", "v2");
    confirm();
  });

  expect(changedEventUserIds()).toEqual(["account-double"]);
});

it("does nothing when a version is recorded outside a delivery scope", () => {
  authorization.recordAccountAuthorizationVersion("account-outside", "v1");
  authorization.withAccountAuthorizationLog((confirm) => {
    confirm();
  });
  deliver("account-outside", "v2");

  expect(changedEventUserIds()).toEqual([]);
});

it("forgets the oldest accounts once more than 4096 accounts were delivered", () => {
  deliver("account-retained", "v1");
  for (let index = 1; index < 4_096; index += 1) {
    deliver(`account-${index}`, "v1");
  }
  deliver("account-retained", "v2");
  deliver("account-newest", "v1");

  deliver("account-1", "v2");
  deliver("account-retained", "v3");

  expect(changedEventUserIds()).toEqual([
    "account-retained",
    "account-retained",
  ]);
});
