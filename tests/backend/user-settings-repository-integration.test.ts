import { describe, expect, it } from "vitest";

import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { ROLE } from "@/definition/Role";
import { LANGUAGE } from "@/language/Language";

import { useMigratedDatabase } from "../helpers/test-database";

import type { StoredUserSettings } from "@/backend/database/repositories/UserSettingsRepository";

const FULL_SETTINGS: StoredUserSettings = {
  dateFormat: "YYYY-MM-DD",
  language: LANGUAGE.ENGLISH,
  notifyAssignments: false,
  notifyDesktop: true,
  notifyDueDates: true,
  notifyEmail: false,
  notifyMentions: true,
  notifyWeeklySummary: false,
  timezone: "Europe/Berlin",
  weekStart: "monday",
};

describe("UserSettingsRepository on DuckDB", () => {
  const getDatabase = useMigratedDatabase();

  async function createRepository(): Promise<UserSettingsRepository> {
    await new UserRepository(getDatabase()).insert({
      displayName: "Anna",
      id: "user-1",
      passwordHash: "hash",
      role: ROLE.EMPLOYEE,
      username: "anna",
    });

    return new UserSettingsRepository(getDatabase());
  }

  it("finds no settings for a user who never saved any", async () => {
    const repository = await createRepository();

    await expect(repository.findByUserId("user-1")).resolves.toBe(null);
    await expect(repository.findLanguageByUserId("user-1")).resolves.toBe(null);
  });

  it("stores and reads back every setting", async () => {
    const repository = await createRepository();

    await repository.upsert("user-1", FULL_SETTINGS);

    await expect(repository.findByUserId("user-1")).resolves.toEqual(
      FULL_SETTINGS,
    );
  });

  it("keeps unset preferences as null", async () => {
    const repository = await createRepository();
    const unset: StoredUserSettings = {
      dateFormat: null,
      language: LANGUAGE.GERMAN,
      notifyAssignments: null,
      notifyDesktop: null,
      notifyDueDates: null,
      notifyEmail: null,
      notifyMentions: null,
      notifyWeeklySummary: null,
      timezone: null,
      weekStart: null,
    };

    await repository.upsert("user-1", unset);

    await expect(repository.findByUserId("user-1")).resolves.toEqual(unset);
  });

  it("replaces the complete row on the next save", async () => {
    const repository = await createRepository();

    await repository.upsert("user-1", FULL_SETTINGS);
    await repository.upsert("user-1", {
      ...FULL_SETTINGS,
      language: LANGUAGE.GERMAN,
      notifyEmail: true,
      timezone: null,
    });

    await expect(repository.findByUserId("user-1")).resolves.toMatchObject({
      language: LANGUAGE.GERMAN,
      notifyEmail: true,
      timezone: null,
    });
  });

  it("changes only the language and keeps the other settings", async () => {
    const repository = await createRepository();

    await repository.upsert("user-1", FULL_SETTINGS);
    await repository.upsertLanguage("user-1", LANGUAGE.GERMAN);

    await expect(repository.findByUserId("user-1")).resolves.toEqual({
      ...FULL_SETTINGS,
      language: LANGUAGE.GERMAN,
    });
    await expect(repository.findLanguageByUserId("user-1")).resolves.toBe(
      LANGUAGE.GERMAN,
    );
  });
});
