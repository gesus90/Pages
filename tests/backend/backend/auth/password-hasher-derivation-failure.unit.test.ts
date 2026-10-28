import { expect, it, vi } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { logCaughtError } from "@/backend/logging/Logger";

import type * as Crypto from "node:crypto";

vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof Crypto>()),
  // The callback is the last of scrypt's arguments.
  scrypt: vi.fn((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function")
      callback(new Error("derivation failed"), Buffer.alloc(0));
  }),
}));

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const STORED_HASH = "scrypt$1024$8$1$c2FsdA==$a2V5";

it("rejects hashing when the key derivation reports an error", async () => {
  await expect(new PasswordHasher().hash("secret")).rejects.toThrow(
    "derivation failed",
  );
});

it("reports an asynchronous derivation error as a failed verification", async () => {
  await expect(
    new PasswordHasher().verify(STORED_HASH, "secret"),
  ).resolves.toBe(false);
  expect(logCaughtError).toHaveBeenCalledWith(
    "PasswordHasher",
    expect.objectContaining({ message: "derivation failed" }),
  );
});
