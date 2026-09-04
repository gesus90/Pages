import { describe, expect, it } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";

describe("PasswordHasher", () => {
  it("creates a verifiable Argon2id hash", async () => {
    const hasher = new PasswordHasher();

    const hashed = await hasher.hash("correct-password");

    expect(typeof hashed).toBe("string");
    expect(hashed).toContain("$argon2id$");
    await expect(hasher.verify(hashed, "correct-password")).resolves.toBe(true);
  });

  it("rejects wrong passwords", async () => {
    const hasher = new PasswordHasher();
    const hashed = await hasher.hash("correct-password");

    await expect(hasher.verify(hashed, "wrong-password")).resolves.toBe(false);
    await expect(hasher.verify(hashed, "")).resolves.toBe(false);
    await expect(hasher.verify(hashed, "Correct-Password")).resolves.toBe(
      false,
    );
  });

  it("supports unicode and long passwords", async () => {
    const hasher = new PasswordHasher();
    const password = "Müller 🚀 ― ".repeat(20);

    const hashed = await hasher.hash(password);

    await expect(hasher.verify(hashed, password)).resolves.toBe(true);
  });

  it("creates unique salts for identical passwords", async () => {
    const hasher = new PasswordHasher();

    const first = await hasher.hash("same-password");
    const second = await hasher.hash("same-password");

    expect(first).not.toBe(second);
    await expect(hasher.verify(first, "same-password")).resolves.toBe(true);
    await expect(hasher.verify(second, "same-password")).resolves.toBe(true);
  });

  it("reports malformed stored hashes as failed verifications", async () => {
    const hasher = new PasswordHasher();

    await expect(hasher.verify("", "password")).resolves.toBe(false);
    await expect(hasher.verify("not-a-hash", "password")).resolves.toBe(false);
    await expect(hasher.verify("$argon2id$broken", "password")).resolves.toBe(
      false,
    );
  });
});
