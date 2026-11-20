import { afterEach, expect, it, vi } from "vitest";

import { logCaughtError } from "@/backend/logging/Logger";

import { PasswordHasher } from "./PasswordHasher";

import type * as NodeCrypto from "node:crypto";

const cryptoBoundary: { scryptError: Error | null } = vi.hoisted(() => ({
  scryptError: null,
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

// Node reports invalid parameters synchronously, so an asynchronous key
// derivation failure is simulated at the crypto boundary; all other calls
// run the real scrypt implementation.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();

  return {
    ...actual,
    scrypt: (...parameters: Parameters<typeof actual.scrypt>): void => {
      if (cryptoBoundary.scryptError) {
        const callback = parameters[4];
        callback(cryptoBoundary.scryptError, Buffer.alloc(0));
        return;
      }

      return actual.scrypt(...parameters);
    },
  };
});

const SCRYPT_PREFIX = "scrypt$32768$8$3$";

function encodedParts(passwordHash: string): string[] {
  return passwordHash.split("$");
}

afterEach(() => {
  cryptoBoundary.scryptError = null;
});

it("encodes the algorithm, cost parameters, salt and derived key", async () => {
  const hasher = new PasswordHasher();

  const passwordHash = await hasher.hash("correct horse");
  const parts = encodedParts(passwordHash);

  expect(passwordHash.startsWith(SCRYPT_PREFIX)).toBe(true);
  expect(parts).toHaveLength(6);
  expect(Buffer.from(parts[4], "base64")).toHaveLength(16);
  expect(Buffer.from(parts[5], "base64")).toHaveLength(64);
});

it("accepts the password it was created for and rejects any other", async () => {
  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hash("correct horse");

  expect(await hasher.verify(passwordHash, "correct horse")).toBe(true);
  expect(await hasher.verify(passwordHash, "Correct horse")).toBe(false);
});

it("salts every hash so equal passwords never produce the same value", async () => {
  const hasher = new PasswordHasher();

  const first = await hasher.hash("same password");
  const second = await hasher.hash("same password");

  expect(first).not.toBe(second);
});

it("recognizes only hashes this hasher can verify", async () => {
  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hash("secret");
  const [, cost, blockSize, parallelization, salt, derivedKey] =
    encodedParts(passwordHash);

  expect(hasher.isSupportedHash(passwordHash)).toBe(true);
  expect(hasher.isSupportedHash(`bcrypt$${cost}`)).toBe(false);
  expect(hasher.isSupportedHash("scrypt$1$2$3$AAAA$AAAA")).toBe(true);
  expect(hasher.isSupportedHash("scrypt$1$2$3$4$5$6")).toBe(false);
  expect(
    hasher.isSupportedHash(
      ["scrypt", cost, blockSize, parallelization, salt].join("$"),
    ),
  ).toBe(false);
  expect(
    hasher.isSupportedHash(
      ["scrypt", "1.5", blockSize, parallelization, salt, derivedKey].join("$"),
    ),
  ).toBe(false);
  expect(
    hasher.isSupportedHash(
      ["scrypt", cost, "0", parallelization, salt, derivedKey].join("$"),
    ),
  ).toBe(false);
  expect(
    hasher.isSupportedHash(
      ["scrypt", cost, blockSize, "-1", salt, derivedKey].join("$"),
    ),
  ).toBe(false);
  expect(
    hasher.isSupportedHash(
      ["scrypt", cost, blockSize, parallelization, "", derivedKey].join("$"),
    ),
  ).toBe(false);
  expect(
    hasher.isSupportedHash(
      ["scrypt", cost, blockSize, parallelization, salt, ""].join("$"),
    ),
  ).toBe(false);
});

it("reports a stored value of an unknown format as a failed verification", async () => {
  const hasher = new PasswordHasher();

  expect(await hasher.verify("bcrypt$not-scrypt", "secret")).toBe(false);
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("reports a stored key of another length as a failed verification", async () => {
  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hash("secret");
  const [scheme, cost, blockSize, parallelization, salt] =
    encodedParts(passwordHash);
  const shortKey = Buffer.alloc(32, 1).toString("base64");

  expect(
    await hasher.verify(
      [scheme, cost, blockSize, parallelization, salt, shortKey].join("$"),
      "secret",
    ),
  ).toBe(false);
});

it("reports a failed key derivation during hashing to the caller", async () => {
  const hasher = new PasswordHasher();
  const failure = new Error("derivation failed");
  cryptoBoundary.scryptError = failure;

  await expect(hasher.hash("secret")).rejects.toBe(failure);
});

it("logs and reports a failed verification when key derivation reports an error", async () => {
  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hash("secret");
  const failure = new Error("derivation failed");
  cryptoBoundary.scryptError = failure;

  expect(await hasher.verify(passwordHash, "secret")).toBe(false);
  expect(logCaughtError).toHaveBeenCalledWith("PasswordHasher", failure);
});

it("logs and reports a failed verification when the stored cost parameters are rejected", async () => {
  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hash("secret");
  const [scheme, , blockSize, parallelization, salt, derivedKey] =
    encodedParts(passwordHash);
  const unsupportedCost = [
    scheme,
    "3",
    blockSize,
    parallelization,
    salt,
    derivedKey,
  ].join("$");

  expect(await hasher.verify(unsupportedCost, "secret")).toBe(false);
  expect(logCaughtError).toHaveBeenCalledWith(
    "PasswordHasher",
    expect.any(Error),
  );
});
