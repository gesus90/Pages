import { expect, it, vi } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { ROLE } from "@/definition/Role";

import { SetupService } from "./SetupService";

const administrator = {
  id: "admin-id",
  username: "admin",
  displayName: "Admin",
  role: ROLE.ADMIN,
  isActive: true,
  mustChangePassword: false,
};

it("migrates only the unchanged bootstrap administrator's unsupported hash", async () => {
  const users = new UserRepository({
    query: vi.fn(),
    execute: vi.fn(),
    transaction: async () => {
      throw new Error("unexpected transaction");
    },
  });
  const find = vi.spyOn(users, "findCredentialsByUsername");
  const update = vi
    .spyOn(users, "updatePasswordHash")
    .mockResolvedValue(undefined);
  const hasher = new PasswordHasher();
  const supported = vi.spyOn(hasher, "isSupportedHash").mockReturnValue(false);
  const hash = vi.spyOn(hasher, "hash").mockResolvedValue("new-hash");
  const service = new SetupService(users, hasher);

  find.mockResolvedValueOnce(null);
  expect(await service.migrateLegacyBootstrapAdministrator()).toBe(false);
  find.mockResolvedValueOnce({
    user: { ...administrator, displayName: "Changed" },
    passwordHash: "old",
  });
  expect(await service.migrateLegacyBootstrapAdministrator()).toBe(false);
  find.mockResolvedValueOnce({
    user: { ...administrator, role: ROLE.EMPLOYEE },
    passwordHash: "old",
  });
  expect(await service.migrateLegacyBootstrapAdministrator()).toBe(false);
  find.mockResolvedValue({ user: administrator, passwordHash: "old" });
  supported.mockReturnValueOnce(true);
  expect(await service.migrateLegacyBootstrapAdministrator()).toBe(false);
  expect(update).not.toHaveBeenCalled();
  expect(await service.migrateLegacyBootstrapAdministrator()).toBe(true);
  expect(find).toHaveBeenCalledWith("admin");
  expect(hash).toHaveBeenCalledWith("admin");
  expect(update).toHaveBeenCalledWith("admin-id", "new-hash");
});
