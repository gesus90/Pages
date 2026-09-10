import { describe, expect, it } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";

describe("PasswordHasher", () => {
  it("creates a verifiable scrypt hash", async () => {
    const hasher = new PasswordHasher();

    const hashed = await hasher.hash("correct-password");

    expect(typeof hashed).toBe("string");
    expect(hashed.startsWith("scrypt$32768$8$3$")).toBe(true);
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

  it("verifies hashes whose parameters differ from the current defaults", async () => {
    const hasher = new PasswordHasher();
    const legacy = [
      "scrypt",
      "16384",
      "8",
      "1",
      "ukua8Ugp2DRRMoIHrMwMSw==",
      "Z+Ka2SLHUZlxtu5DnyhT3GWE4JOLt6p5TZDWUQW4bYybbUi5vfG6i08In5" +
        "yf3ZtN08BFRH6Fd5H6iKSNwnUaxA==",
    ].join("$");

    expect(hasher.isSupportedHash(legacy)).toBe(true);
    await expect(hasher.verify(legacy, "stable-password")).resolves.toBe(true);
    await expect(hasher.verify(legacy, "wrong-password")).resolves.toBe(false);
  });

  it("reports malformed stored hashes as failed verifications", async () => {
    const hasher = new PasswordHasher();

    await expect(hasher.verify("", "password")).resolves.toBe(false);
    await expect(hasher.verify("not-a-hash", "password")).resolves.toBe(false);
    await expect(hasher.verify("scrypt$broken", "password")).resolves.toBe(
      false,
    );
    await expect(hasher.verify("$argon2id$broken", "password")).resolves.toBe(
      false,
    );
  });

  it("reports hashes with invalid parameters as failed verifications", async () => {
    const hasher = new PasswordHasher();

    await expect(
      hasher.verify("scrypt$abc$8$3$c2FsdA$a2V5", "password"),
    ).resolves.toBe(false);
    await expect(
      hasher.verify("scrypt$0$8$3$c2FsdA$a2V5", "password"),
    ).resolves.toBe(false);
    await expect(
      hasher.verify("scrypt$32768$0$3$c2FsdA$a2V5", "password"),
    ).resolves.toBe(false);
    await expect(
      hasher.verify("scrypt$32768$8$0$c2FsdA$a2V5", "password"),
    ).resolves.toBe(false);
    await expect(
      hasher.verify("scrypt$32768$8$3$$a2V5", "password"),
    ).resolves.toBe(false);
    await expect(
      hasher.verify("scrypt$32768$8$3$c2FsdA$", "password"),
    ).resolves.toBe(false);
  });

  it("reports hashes rejected by scrypt as failed verifications", async () => {
    const hasher = new PasswordHasher();

    await expect(
      hasher.verify("scrypt$3$8$1$c2FsdA$a2V5", "password"),
    ).resolves.toBe(false);
  });

  it("reports truncated derived keys as failed verifications", async () => {
    const hasher = new PasswordHasher();
    const hashed = await hasher.hash("correct-password");
    const parts = hashed.split("$");
    const truncated = [...parts.slice(0, 5), "AA"].join("$");

    await expect(hasher.verify(truncated, "correct-password")).resolves.toBe(
      false,
    );
  });
});

describe("PasswordHasher hash recognition", () => {
  it("recognizes hashes it produced", async () => {
    const hasher = new PasswordHasher();

    expect(hasher.isSupportedHash(await hasher.hash("secret"))).toBe(true);
  });

  it("rejects foreign and malformed values", () => {
    const hasher = new PasswordHasher();

    expect(hasher.isSupportedHash("")).toBe(false);
    expect(hasher.isSupportedHash("plain-password")).toBe(false);
    expect(
      hasher.isSupportedHash("$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA"),
    ).toBe(false);
    expect(hasher.isSupportedHash("scrypt$not$enough")).toBe(false);
  });
});
