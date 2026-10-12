import { mkdtemp, open, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CredentialStore,
  CredentialStoreError,
} from "../../mcp/src/credential-store";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

const instance = new URL("http://192.168.1.9:4567");
const stored = {
  tokenId: "id",
  token: "a".repeat(43),
  name: "Client",
  expiresAt: null,
  pairedAt: 1,
};
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-a11-10-g7-lock-"));
  const original = (
    await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  ).open;
  vi.mocked(open).mockImplementation(original);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("credential lock acquisition", () => {
  it.each([
    [
      "a permission error",
      Object.assign(new Error("denied"), { code: "EACCES" }),
    ],
    ["a non-error rejection", "unexpected"],
    ["a null rejection", null],
  ])(
    "fails fast with the fixed diagnostic after %s and runs no operation",
    async (_label, failure) => {
      const store = new CredentialStore({ XDG_CONFIG_HOME: directory });
      const operation = vi.fn(async () => ({
        credential: stored,
        result: "done",
      }));
      vi.mocked(open).mockRejectedValueOnce(failure);
      await expect(store.update(instance, operation)).rejects.toThrow(
        new CredentialStoreError(),
      );
      expect(operation).not.toHaveBeenCalled();
      expect(await readdir(path.join(directory, "pages-mcp"))).toEqual([]);
    },
  );

  it("works again once the lock can be created", async () => {
    const store = new CredentialStore({ XDG_CONFIG_HOME: directory });
    vi.mocked(open).mockRejectedValueOnce(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    await expect(
      store.update(instance, async () => ({
        credential: stored,
        result: undefined,
      })),
    ).rejects.toBeInstanceOf(CredentialStoreError);
    await store.update(instance, async () => ({
      credential: stored,
      result: undefined,
    }));
    expect(await store.get(instance)).toEqual(stored);
  });
});
