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
});
