import { describe, expect, it } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { generateTemporaryPassword } from "@/backend/auth/TemporaryPassword";

describe("PasswordHasher", () => {
  const hasher = new PasswordHasher();

  it("creates a self-describing hash that verifies the same password only", async () => {
    const hash = await hasher.hash("correct horse");

    expect(hash.split("$")).toHaveLength(6);
    expect(hash.startsWith("scrypt$32768$8$3$")).toBe(true);
    expect(hasher.isSupportedHash(hash)).toBe(true);
    await expect(hasher.verify(hash, "correct horse")).resolves.toBe(true);
    await expect(hasher.verify(hash, "wrong horse")).resolves.toBe(false);
  });

  it("salts every hash so equal passwords differ", async () => {
    const [first, second] = await Promise.all([
      hasher.hash("same"),
      hasher.hash("same"),
    ]);

    expect(first).not.toBe(second);
  });

  it.each([
    ["an empty value", ""],
    ["another algorithm", "bcrypt$10$8$3$c2FsdA==$a2V5"],
    ["too few parts", "scrypt$1024$8$3$c2FsdA=="],
    ["a non-integer cost", "scrypt$1.5$8$3$c2FsdA==$a2V5"],
    ["a non-numeric cost", "scrypt$many$8$3$c2FsdA==$a2V5"],
    ["a zero block size", "scrypt$1024$0$3$c2FsdA==$a2V5"],
    ["a negative parallelization", "scrypt$1024$8$-1$c2FsdA==$a2V5"],
    ["an empty salt", "scrypt$1024$8$3$$a2V5"],
    ["an empty key", "scrypt$1024$8$3$c2FsdA==$"],
  ])("reports %s as unsupported and never verifies it", async (_, hash) => {
    expect(hasher.isSupportedHash(hash)).toBe(false);
    await expect(hasher.verify(hash, "anything")).resolves.toBe(false);
  });

  it("reports parameters that scrypt rejects as a failed verification", async () => {
    // N must be a power of two; the parsed hash is well-formed but unusable.
    const hash = "scrypt$1000$8$3$c2FsdA==$a2V5";

    expect(hasher.isSupportedHash(hash)).toBe(true);
    await expect(hasher.verify(hash, "anything")).resolves.toBe(false);
  });

  it("keeps verifying hashes that were created with other cost parameters", async () => {
    const stored = await hasher.hash("secret");
    const [algorithm, , blockSize, parallelization, salt, key] =
      stored.split("$");
    const other = [algorithm, "16384", blockSize, parallelization, salt, key];

    await expect(hasher.verify(other.join("$"), "secret")).resolves.toBe(false);
    await expect(hasher.verify(stored, "secret")).resolves.toBe(true);
  });
});

describe("generateTemporaryPassword", () => {
  it("returns three groups of four unambiguous characters", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(generateTemporaryPassword()).toMatch(
        /^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}(-[abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}){2}$/u,
      );
    }
  });

  it("does not repeat between calls", () => {
    expect(generateTemporaryPassword()).not.toBe(generateTemporaryPassword());
  });
});
