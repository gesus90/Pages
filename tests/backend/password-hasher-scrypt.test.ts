import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();

  return {
    ...actual,
    scrypt: vi.fn(),
  };
});

import { scrypt } from "node:crypto";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";

const mockedScrypt = scrypt as unknown as ReturnType<typeof vi.fn>;

describe("PasswordHasher scrypt failures", () => {
  beforeEach(() => {
    mockedScrypt.mockImplementation(
      (
        _password: unknown,
        _salt: unknown,
        _keyLength: unknown,
        _options: unknown,
        callback: (error: Error | null, derivedKey?: Buffer) => void,
      ): void => {
        callback(new Error("Out of memory"));
      },
    );
  });

  it("reports callback errors as failed verifications", async () => {
    const hasher = new PasswordHasher();

    await expect(
      hasher.verify("scrypt$32768$8$3$c2FsdA$a2V5", "password"),
    ).resolves.toBe(false);
    expect(mockedScrypt).toHaveBeenCalledTimes(1);
  });

  it("propagates callback errors while hashing", async () => {
    const hasher = new PasswordHasher();

    await expect(hasher.hash("password")).rejects.toThrow("Out of memory");
  });
});
