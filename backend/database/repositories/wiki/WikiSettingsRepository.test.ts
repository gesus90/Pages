import { expect, it, vi } from "vitest";

import { WikiSettingsRepository } from "./WikiSettingsRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

const settings = {
  fileLimitBytes: 5,
  mediaLimitBytes: 4,
  trashRetentionDays: 1,
  versionKeepLast: 3,
  versionRetentionDays: 2,
};

it("returns null while no settings were saved", async () => {
  const database: DatabaseTransaction = {
    execute: async () => {},
    query: async () => [],
  };

  await expect(new WikiSettingsRepository(database).find()).resolves.toBeNull();
});

it("reads the stored settings", async () => {
  const database: DatabaseTransaction = {
    execute: async () => {},
    query: async () => [[1, 2, 3, 4, 5n]],
  };

  await expect(new WikiSettingsRepository(database).find()).resolves.toEqual(
    settings,
  );
});

it("saves the settings with named parameters", async () => {
  const execute = vi.fn(async () => {});
  const database: DatabaseTransaction = { execute, query: async () => [] };

  await new WikiSettingsRepository(database).save(settings);

  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO wiki_settings"),
    {
      file_limit_bytes: 5,
      media_limit_bytes: 4,
      trash_retention_days: 1,
      version_keep_last: 3,
      version_retention_days: 2,
    },
  );
});
