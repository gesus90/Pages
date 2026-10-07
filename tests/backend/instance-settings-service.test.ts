import { describe, expect, it } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { InstanceSettingsRepository } from "@/backend/database/repositories/InstanceSettingsRepository";
import {
  InstanceSettingsDeniedError,
  InstanceSettingsService,
} from "@/backend/service/InstanceSettingsService";
import { ROLE } from "@/definition/Role";

import { useMigratedDatabase } from "../helpers/test-database";

import type { User } from "@/definition/User";

function createUser(role: User["role"]): User {
  return {
    displayName: "A",
    id: "u1",
    isActive: true,
    mustChangePassword: false,
    role,
    username: "a",
  };
}

const ADMIN = createUser(ROLE.ADMIN);
const LOGO = { data: Buffer.from("logo-bytes"), mimeType: "image/png" };

describe("InstanceSettingsService", () => {
  const getDatabase = useMigratedDatabase();

  async function createService(): Promise<InstanceSettingsService> {
    const repository = new InstanceSettingsRepository(getDatabase());

    await repository.save({
      companyName: "Muster GmbH",
      primaryAdministratorId: "u1",
    });

    return new InstanceSettingsService(repository, new PermissionService());
  }

  it("has no branding before the setup", async () => {
    const service = new InstanceSettingsService(
      new InstanceSettingsRepository(getDatabase()),
      new PermissionService(),
    );

    await expect(service.getBranding()).resolves.toEqual({
      companyName: null,
      logoUrl: null,
    });
  });

  it("names the company and gives the logo an address that changes with it", async () => {
    const service = await createService();

    await expect(service.getBranding()).resolves.toEqual({
      companyName: "Muster GmbH",
      logoUrl: null,
    });

    await service.replaceLogo(ADMIN, LOGO);

    const branding = await service.getBranding();

    expect(branding.logoUrl).toMatch(/^\/instance-logo\?v=/u);
    await expect(service.getLogo()).resolves.toMatchObject(LOGO);
  });

  it("changes the company name after trimming it", async () => {
    const service = await createService();

    await expect(service.updateCompanyName(ADMIN, "  Neue AG ")).resolves.toBe(
      true,
    );
    await expect(service.getBranding()).resolves.toMatchObject({
      companyName: "Neue AG",
    });
  });

  it.each(["", "   ", "x".repeat(201)])(
    "rejects the company name %j",
    async (name) => {
      const service = await createService();

      await expect(service.updateCompanyName(ADMIN, name)).resolves.toBe(false);
      await expect(service.getBranding()).resolves.toMatchObject({
        companyName: "Muster GmbH",
      });
    },
  );

  it("replaces and removes the logo", async () => {
    const service = await createService();

    await service.replaceLogo(ADMIN, LOGO);
    await service.replaceLogo(ADMIN, { ...LOGO, data: Buffer.from("second") });

    await expect(service.getLogo()).resolves.toMatchObject({
      data: Buffer.from("second"),
    });

    await service.removeLogo(ADMIN);

    await expect(service.getLogo()).resolves.toBeNull();
    await expect(service.getBranding()).resolves.toMatchObject({
      logoUrl: null,
    });
  });

  it("lets only administrators change anything", async () => {
    const service = await createService();
    const manager = createUser(ROLE.MANAGER);

    await expect(service.updateCompanyName(manager, "X")).rejects.toThrow(
      InstanceSettingsDeniedError,
    );
    await expect(service.replaceLogo(manager, LOGO)).rejects.toThrow(
      InstanceSettingsDeniedError,
    );
    await expect(service.removeLogo(manager)).rejects.toThrow(
      InstanceSettingsDeniedError,
    );
  });
});
