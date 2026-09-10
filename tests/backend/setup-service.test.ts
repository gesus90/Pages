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
    hasUsers: ReturnType<typeof vi.fn>;
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
      hasUsers: vi.fn(),
      insert: vi.fn(),
      updatePasswordHash: vi.fn(),
    } as unknown as UserRepository & {
      findCredentialsByUsername: ReturnType<typeof vi.fn>;
      hasUsers: ReturnType<typeof vi.fn>;
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

  it("reports that setup is required when no users exist", async () => {
    doubles.repository.hasUsers.mockResolvedValue(false);

    await expect(service.isSetupRequired()).resolves.toBe(true);
  });

  it("reports that setup is complete when users exist", async () => {
    doubles.repository.hasUsers.mockResolvedValue(true);

    await expect(service.isSetupRequired()).resolves.toBe(false);
  });

  it("creates the default administrator on a fresh installation", async () => {
    doubles.repository.hasUsers.mockResolvedValue(false);
    doubles.hasher.hash.mockResolvedValue("encoded-admin-hash");
    doubles.repository.insert.mockResolvedValue(undefined);

    await expect(service.ensureDefaultAdministrator()).resolves.toBe(true);

    expect(doubles.hasher.hash).toHaveBeenCalledTimes(1);
    expect(doubles.hasher.hash).toHaveBeenCalledWith("admin");
    expect(doubles.repository.insert).toHaveBeenCalledTimes(1);

    const inserted = doubles.repository.insert.mock.calls[0]?.[0] as {
      displayName: string;
      id: string;
      passwordHash: string;
      role: string;
      username: string;
    };

    expect(inserted.username).toBe("admin");
    expect(inserted.displayName).toBe("Admin");
    expect(inserted.passwordHash).toBe("encoded-admin-hash");
    expect(inserted.role).toBe(ROLE.ADMIN);
    expect(typeof inserted.id).toBe("string");
    expect(inserted.id.length).toBeGreaterThan(0);
  });

  it("creates unique identifiers for repeated fresh installations", async () => {
    doubles.repository.hasUsers.mockResolvedValue(false);
    doubles.hasher.hash.mockResolvedValue("hash");
    doubles.repository.insert.mockResolvedValue(undefined);

    const first = new SetupService(doubles.repository, doubles.hasher);
    const second = new SetupService(doubles.repository, doubles.hasher);

    await first.ensureDefaultAdministrator();
    await second.ensureDefaultAdministrator();

    const firstId = (
      doubles.repository.insert.mock.calls[0]?.[0] as { id: string }
    ).id;
    const secondId = (
      doubles.repository.insert.mock.calls[1]?.[0] as { id: string }
    ).id;

    expect(firstId).not.toBe(secondId);
  });

  it("leaves an existing installation untouched", async () => {
    doubles.repository.hasUsers.mockResolvedValue(true);

    await expect(service.ensureDefaultAdministrator()).resolves.toBe(false);

    expect(doubles.hasher.hash).not.toHaveBeenCalled();
    expect(doubles.repository.insert).not.toHaveBeenCalled();
  });

  it("propagates failures while checking for users", async () => {
    doubles.repository.hasUsers.mockRejectedValue(
      new Error("Database unavailable"),
    );

    await expect(service.isSetupRequired()).rejects.toThrow(
      "Database unavailable",
    );
    await expect(service.ensureDefaultAdministrator()).rejects.toThrow(
      "Database unavailable",
    );
  });

  it("propagates hashing failures without inserting a user", async () => {
    doubles.repository.hasUsers.mockResolvedValue(false);
    doubles.hasher.hash.mockRejectedValue(new Error("Hashing failed"));

    await expect(service.ensureDefaultAdministrator()).rejects.toThrow(
      "Hashing failed",
    );
    expect(doubles.repository.insert).not.toHaveBeenCalled();
  });

  it("propagates insert failures", async () => {
    doubles.repository.hasUsers.mockResolvedValue(false);
    doubles.hasher.hash.mockResolvedValue("hash");
    doubles.repository.insert.mockRejectedValue(new Error("Insert failed"));

    await expect(service.ensureDefaultAdministrator()).rejects.toThrow(
      "Insert failed",
    );
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
