import { describe, expect, it } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { SettingsService } from "@/backend/service/SettingsService";
import {
  DEFAULT_USER_SETTINGS,
  USER_THEMES,
  isUserTheme,
} from "@/definition/Settings";
import { LANGUAGE } from "@/language/Language";

import { useMigratedDatabase } from "../helpers/test-database";

describe("PAGE-29 user theme definition", () => {
  it("offers light, dark and system and starts with the system", () => {
    expect([...USER_THEMES]).toEqual(["light", "dark", "system"]);
    expect(DEFAULT_USER_SETTINGS.theme).toBe("system");
  });

  it.each(["light", "dark", "system"])("accepts %s", (theme) => {
    expect(isUserTheme(theme)).toBe(true);
  });

  it.each([["sepia"], [""], [null], [undefined], [1], [["dark"]]])(
    "rejects %j",
    (value) => {
      expect(isUserTheme(value)).toBe(false);
    },
  );
});

describe("PAGE-29 user theme persistence on DuckDB", () => {
  const getDatabase = useMigratedDatabase();

  function createService(): SettingsService {
    return new SettingsService(new UserSettingsRepository(getDatabase()));
  }

  it("gives a user without a settings row the system theme", async () => {
    await expect(
      createService().getUserSettings("nobody"),
    ).resolves.toMatchObject({ theme: "system" });
  });

  it.each(["light", "dark", "system"] as const)(
    "restores the %s theme the user saved",
    async (theme) => {
      const service = createService();

      await service.updateSettings("user-1", {
        ...DEFAULT_USER_SETTINGS,
        theme,
      });

      // A second service on the same database stands for the next sign-in.
      await expect(
        createService().getUserSettings("user-1"),
      ).resolves.toMatchObject({ theme });
    },
  );

  it("keeps the theme of every user apart", async () => {
    const service = createService();

    await service.updateSettings("user-1", {
      ...DEFAULT_USER_SETTINGS,
      theme: "dark",
    });
    await service.updateSettings("user-2", {
      ...DEFAULT_USER_SETTINGS,
      theme: "light",
    });

    await expect(service.getUserSettings("user-1")).resolves.toMatchObject({
      theme: "dark",
    });
    await expect(service.getUserSettings("user-2")).resolves.toMatchObject({
      theme: "light",
    });
    await expect(service.getUserSettings("user-3")).resolves.toMatchObject({
      theme: "system",
    });
  });

  it("replaces the theme on the next save", async () => {
    const service = createService();

    await service.updateSettings("user-1", {
      ...DEFAULT_USER_SETTINGS,
      theme: "dark",
    });
    await service.updateSettings("user-1", {
      ...DEFAULT_USER_SETTINGS,
      theme: "light",
    });

    await expect(service.getUserSettings("user-1")).resolves.toMatchObject({
      theme: "light",
    });
  });

  it("keeps the theme when only the language changes", async () => {
    const service = createService();

    await service.updateSettings("user-1", {
      ...DEFAULT_USER_SETTINGS,
      theme: "dark",
    });
    await service.updateLanguage("user-1", LANGUAGE.ENGLISH);

    await expect(service.getUserSettings("user-1")).resolves.toMatchObject({
      language: LANGUAGE.ENGLISH,
      theme: "dark",
    });
  });

  it("falls back to the system theme for a stored value that is not supported", async () => {
    await createService().updateSettings("user-1", DEFAULT_USER_SETTINGS);
    await getDatabase().execute(
      "UPDATE user_settings SET theme = 'sepia' WHERE user_id = 'user-1';",
    );

    await expect(
      createService().getUserSettings("user-1"),
    ).resolves.toMatchObject({ theme: "system" });
  });
});

describe("PAGE-29 migration 040", () => {
  it("names the migration after the next free number", () => {
    const names = DATABASE_MIGRATIONS.map((migration) => migration.name).sort();
    const index = names.indexOf("040_user_theme.sql");

    expect(names[index - 1]).toBe("039_agent_connection_scopes.sql");
    expect(names.filter((name) => name.startsWith("040_"))).toHaveLength(1);
  });

  it("keeps existing settings and lets them follow the system", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);

    try {
      await database.migrate(
        DATABASE_MIGRATIONS.filter((migration) => migration.name < "040"),
      );
      await database.execute(`
        INSERT INTO user_settings (user_id, language, timezone, notify_email)
        VALUES ('legacy-user', 'en', 'Europe/Berlin', 0);
      `);

      await database.migrate(DATABASE_MIGRATIONS);

      const service = new SettingsService(new UserSettingsRepository(database));

      await expect(service.getUserSettings("legacy-user")).resolves.toEqual({
        ...DEFAULT_USER_SETTINGS,
        language: LANGUAGE.ENGLISH,
        notifications: {
          ...DEFAULT_USER_SETTINGS.notifications,
          email: false,
        },
        timezone: "Europe/Berlin",
      });
      await expect(
        database.query(
          "SELECT theme FROM user_settings WHERE user_id = 'legacy-user';",
        ),
      ).resolves.toEqual([[null]]);
    } finally {
      await database.close();
    }
  });

  it("is applied once and can run again without changing anything", async () => {
    const database = await Database.create(IN_MEMORY_DATABASE_PATH);

    try {
      await database.migrate(DATABASE_MIGRATIONS);
      await database.migrate(DATABASE_MIGRATIONS);

      const columns = await database.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'user_settings' AND column_name = 'theme';
      `);

      expect(columns).toEqual([["theme"]]);
    } finally {
      await database.close();
    }
  });
});
