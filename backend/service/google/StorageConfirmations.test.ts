import { describe, expect, it } from "vitest";

import { StorageConfirmations } from "./StorageConfirmations";

import type { ConfirmationBinding } from "./StorageConfirmations";
import type { StorageEntry } from "@/definition/GoogleDriveFiles";

function entryOf(overrides: Partial<StorageEntry> = {}): StorageEntry {
  return {
    ref: "file-1",
    name: "File",
    isFolder: false,
    mimeType: "text/plain",
    isGoogleDocument: false,
    isTrashed: false,
    isExplicitlyTrashed: false,
    modifiedAt: "2030-01-01T00:00:00Z",
    sizeBytes: 1,
    parentRef: null,
    driveRef: null,
    version: "3",
    webViewLink: null,
    exportFormats: [],
    ...overrides,
  };
}

function bindingOf(
  overrides: Partial<ConfirmationBinding> = {},
): ConfirmationBinding {
  return {
    userId: "user-1",
    action: "overwrite",
    entry: entryOf(),
    scope: null,
    ...overrides,
  };
}

describe("StorageConfirmations", () => {
  it("issues a token with the target, scope and expiry", () => {
    const store = new StorageConfirmations(() => 0);
    const scope = {
      folderCount: 1,
      fileCount: 2,
      totalBytes: 3,
      isTruncated: false,
    };
    const confirmation = store.issue(bindingOf({ scope }));

    expect(confirmation.action).toBe("overwrite");
    expect(confirmation.scope).toBe(scope);
    expect(confirmation.target.ref).toBe("file-1");
    expect(confirmation.expiresAt).toBe("1970-01-01T00:10:00.000Z");
    expect(confirmation.token.length).toBeGreaterThan(20);
  });

  it("uses the system clock by default", () => {
    const store = new StorageConfirmations();
    const confirmation = store.issue(bindingOf());

    expect(store.consume(confirmation.token, bindingOf())).toBe(true);
  });

  it("spends a matching confirmation once", () => {
    const store = new StorageConfirmations(() => 0);
    const { token } = store.issue(bindingOf());

    expect(store.consume(token, bindingOf())).toBe(true);
    expect(store.consume(token, bindingOf())).toBe(false);
  });

  it("refuses an unknown token", () => {
    const store = new StorageConfirmations(() => 0);

    expect(store.consume("missing", bindingOf())).toBe(false);
  });

  it("refuses another account without spending the token", () => {
    const store = new StorageConfirmations(() => 0);
    const { token } = store.issue(bindingOf());

    expect(store.consume(token, bindingOf({ userId: "other" }))).toBe(false);
    expect(store.consume(token, bindingOf())).toBe(true);
  });

  it("refuses and spends a token whose binding differs", () => {
    const store = new StorageConfirmations(() => 0);
    const changes: Partial<ConfirmationBinding>[] = [
      { action: "delete_permanently" },
      { entry: entryOf({ ref: "other" }) },
      { entry: entryOf({ version: "4" }) },
      {
        scope: {
          folderCount: 0,
          fileCount: 0,
          totalBytes: 0,
          isTruncated: false,
        },
      },
    ];

    for (const change of changes) {
      const { token } = store.issue(bindingOf());

      expect(store.consume(token, bindingOf(change))).toBe(false);
      expect(store.consume(token, bindingOf())).toBe(false);
    }
  });

  it("refuses an expired confirmation", () => {
    let now = 0;
    const store = new StorageConfirmations(() => now);
    const { token } = store.issue(bindingOf());

    now = 10 * 60 * 1000;

    expect(store.consume(token, bindingOf())).toBe(false);
  });

  it("prunes expired confirmations when issuing", () => {
    let now = 0;
    const store = new StorageConfirmations(() => now);
    const old = store.issue(bindingOf());

    now = 11 * 60 * 1000;
    store.issue(bindingOf());

    now = 0;

    expect(store.consume(old.token, bindingOf())).toBe(false);
  });

  it("evicts the oldest confirmation at the memory limit", () => {
    const store = new StorageConfirmations(() => 0);
    const first = store.issue(bindingOf());
    const tokens: string[] = [];

    for (let index = 0; index < 1000; index += 1) {
      tokens.push(store.issue(bindingOf()).token);
    }

    expect(store.consume(first.token, bindingOf())).toBe(false);
    expect(store.consume(tokens[999] ?? "", bindingOf())).toBe(true);
  });
});
