import { describe, expect, it } from "vitest";

import { InstanceSettingsRepository } from "@/backend/database/repositories/InstanceSettingsRepository";

import { useMigratedDatabase } from "../helpers/test-database";

describe("InstanceSettingsRepository", () => {
  const getDatabase = useMigratedDatabase();

  it("has no settings before the first setup", async () => {
    await expect(
      new InstanceSettingsRepository(getDatabase()).find(),
    ).resolves.toBeNull();
  });

  it("stores one row and replaces it on a later setup", async () => {
    const repository = new InstanceSettingsRepository(getDatabase());

    await repository.save({
      companyName: "Erste GmbH",
      primaryAdministratorId: "u1",
    });
    await repository.save({
      companyName: "Zweite AG",
      primaryAdministratorId: "u2",
    });

    await expect(repository.find()).resolves.toEqual({
      companyName: "Zweite AG",
      primaryAdministratorId: "u2",
    });

    const rows = await getDatabase().query(
      "SELECT COUNT(*) FROM instance_settings;",
    );

    expect(rows).toEqual([[1]]);
  });

  it("renames the company without touching the administrator", async () => {
    const repository = new InstanceSettingsRepository(getDatabase());

    await repository.save({
      companyName: "Erste GmbH",
      primaryAdministratorId: "u1",
    });
    await repository.updateCompanyName("Umbenannt AG");

    await expect(repository.find()).resolves.toEqual({
      companyName: "Umbenannt AG",
      primaryAdministratorId: "u1",
    });
  });

  it("stores, replaces, and deletes one logo", async () => {
    const repository = new InstanceSettingsRepository(getDatabase());

    await expect(repository.findLogo()).resolves.toBeNull();
    await expect(repository.findLogoVersion()).resolves.toBeNull();

    await repository.saveLogo({
      data: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
    });
    await repository.saveLogo({
      data: Buffer.from([4, 5]),
      mimeType: "image/webp",
    });

    await expect(repository.findLogo()).resolves.toMatchObject({
      data: Buffer.from([4, 5]),
      mimeType: "image/webp",
    });
    await expect(repository.findLogoVersion()).resolves.toMatch(/^\d{4}-/u);
    expect(
      await getDatabase().query("SELECT COUNT(*) FROM instance_logo;"),
    ).toEqual([[1]]);

    await repository.deleteLogo();

    await expect(repository.findLogo()).resolves.toBeNull();
  });
});
