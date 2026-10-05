import { beforeEach, describe, expect, it, vi } from "vitest";

import { SetupService } from "@/backend/setup/SetupService";
import { ROLE } from "@/definition/Role";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";

function createDoubles(): {
  hasher: PasswordHasher & {
    hash: ReturnType<typeof vi.fn>;
    isSupportedHash: ReturnType<typeof vi.fn>;
  };
  repository: UserRepository & {
    findCredentialsByUsername: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    updatePasswordHash: ReturnType<typeof vi.fn>;
  };
} {
  return {
    hasher: {
      hash: vi.fn(),
      isSupportedHash: vi.fn(),
      verify: vi.fn(),
    } as unknown as PasswordHasher & {
      hash: ReturnType<typeof vi.fn>;
      isSupportedHash: ReturnType<typeof vi.fn>;
    },
    repository: {
      findById: vi.fn(),
      findCredentialsByUsername: vi.fn(),
      insert: vi.fn(),
      updatePasswordHash: vi.fn(),
    } as unknown as UserRepository & {
      findCredentialsByUsername: ReturnType<typeof vi.fn>;
      insert: ReturnType<typeof vi.fn>;
      updatePasswordHash: ReturnType<typeof vi.fn>;
    },
  };
}

function createAdministrator(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
    ...overrides,
  };
}

describe("SetupService", () => {
  let doubles: ReturnType<typeof createDoubles>;
  let service: SetupService;

  beforeEach(() => {
    doubles = createDoubles();
    service = new SetupService(doubles.repository, doubles.hasher);
  });

  it("migrates the untouched bootstrap administrator to scrypt", async () => {
    doubles.repository.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "$argon2id$legacy",
      user: createAdministrator(),
    });
    doubles.hasher.isSupportedHash.mockReturnValue(false);
    doubles.hasher.hash.mockResolvedValue("scrypt-hash");
    doubles.repository.updatePasswordHash.mockResolvedValue(undefined);

    await expect(service.migrateLegacyBootstrapAdministrator()).resolves.toBe(
      true,
    );

    expect(doubles.hasher.hash).toHaveBeenCalledWith("admin");
    expect(doubles.repository.updatePasswordHash).toHaveBeenCalledWith(
      "user-1",
      "scrypt-hash",
    );
  });

  it("leaves missing administrators untouched", async () => {
    doubles.repository.findCredentialsByUsername.mockResolvedValue(null);

    await expect(service.migrateLegacyBootstrapAdministrator()).resolves.toBe(
      false,
    );

    expect(doubles.repository.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("leaves renamed bootstrap administrators untouched", async () => {
    doubles.repository.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "$argon2id$legacy",
      user: createAdministrator({ displayName: "Root" }),
    });

    await expect(service.migrateLegacyBootstrapAdministrator()).resolves.toBe(
      false,
    );

    expect(doubles.repository.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("leaves demoted bootstrap administrators untouched", async () => {
    doubles.repository.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "$argon2id$legacy",
      user: createAdministrator({ role: ROLE.EMPLOYEE }),
    });

    await expect(service.migrateLegacyBootstrapAdministrator()).resolves.toBe(
      false,
    );

    expect(doubles.repository.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("leaves current scrypt hashes untouched", async () => {
    doubles.repository.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "scrypt$32768$8$3$c2FsdA$aGFzaA",
      user: createAdministrator(),
    });
    doubles.hasher.isSupportedHash.mockReturnValue(true);

    await expect(service.migrateLegacyBootstrapAdministrator()).resolves.toBe(
      false,
    );

    expect(doubles.hasher.hash).not.toHaveBeenCalled();
    expect(doubles.repository.updatePasswordHash).not.toHaveBeenCalled();
  });
});
