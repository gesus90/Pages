import { describe, expect, it } from "vitest";

import { StorageConfirmations } from "@/backend/service/google/StorageConfirmations";

import { makeEntry } from "./storage-file-writer-harness";

import type { ConfirmationBinding } from "@/backend/service/google/StorageConfirmations";

const binding: ConfirmationBinding = {
  userId: "user",
  action: "delete",
  entry: makeEntry("file"),
  scope: null,
};

describe("StorageConfirmations", () => {
  it("binds a token to its user and spends it once", () => {
    const store = new StorageConfirmations(() => 0);
    const confirmation = store.issue(binding);
    expect(
      store.consume(confirmation.token, { ...binding, userId: "other" }),
    ).toBe(false);
    expect(store.consume(confirmation.token, binding)).toBe(true);
    expect(store.consume(confirmation.token, binding)).toBe(false);
  });

  it("rejects changed state and spends the token", () => {
    const store = new StorageConfirmations(() => 0);
    const confirmation = store.issue(binding);
    expect(
      store.consume(confirmation.token, {
        ...binding,
        entry: { ...binding.entry, version: "changed" },
      }),
    ).toBe(false);
    expect(store.consume(confirmation.token, binding)).toBe(false);
  });

  it("expires confirmations at the deadline and prunes old tokens", () => {
    let now = 0;
    const store = new StorageConfirmations(() => now);
    const confirmation = store.issue(binding);
    now = 600_000;
    store.issue(binding);
    expect(store.consume(confirmation.token, binding)).toBe(false);
  });
});
