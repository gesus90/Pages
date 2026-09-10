import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { LANGUAGE } from "@/language/Language";

import type { Database } from "@/backend/database/Database";

function createDatabase(): Database & {
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(),
    execute: vi.fn(),
    migrate: vi.fn(),
    query: vi.fn(),
  } as unknown as Database & {
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
}

describe("UserSettingsRepository", () => {
  let database: ReturnType<typeof createDatabase>;
  let repository: UserSettingsRepository;

  beforeEach(() => {
    database = createDatabase();
    repository = new UserSettingsRepository(database);
  });

  it("returns the stored language for a user", async () => {
    database.query.mockResolvedValue([["de"]]);

    await expect(repository.findLanguageByUserId("user-1")).resolves.toBe(
      LANGUAGE.GERMAN,
    );
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM user_settings"),
      { user_id: "user-1" },
    );
  });

  it("returns English choices unchanged", async () => {
    database.query.mockResolvedValue([["en"]]);

    await expect(repository.findLanguageByUserId("user-1")).resolves.toBe(
      LANGUAGE.ENGLISH,
    );
  });

  it("returns null when the user has no settings row", async () => {
    database.query.mockResolvedValue([]);

    await expect(repository.findLanguageByUserId("user-1")).resolves.toBeNull();
  });

  it("throws for stored languages Pages does not understand", async () => {
    database.query.mockResolvedValue([["fr"]]);

    await expect(repository.findLanguageByUserId("user-1")).rejects.toThrow(
      'Database returned an unsupported language "fr".',
    );
  });

  it("creates or updates the stored language", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.upsertLanguage("user-1", LANGUAGE.ENGLISH);

    expect(database.execute).toHaveBeenCalledTimes(1);
    const [statement, parameters] = database.execute.mock.calls[0] as [
      string,
      Record<string, string>,
    ];

    expect(statement).toContain("INSERT INTO user_settings");
    expect(statement).toContain("ON CONFLICT (user_id) DO UPDATE");
    expect(parameters).toEqual({ language: "en", user_id: "user-1" });
  });

  it("propagates database failures", async () => {
    database.query.mockRejectedValue(new Error("Query failed"));

    await expect(repository.findLanguageByUserId("user-1")).rejects.toThrow(
      "Query failed",
    );

    database.execute.mockRejectedValue(new Error("Write failed"));

    await expect(
      repository.upsertLanguage("user-1", LANGUAGE.GERMAN),
    ).rejects.toThrow("Write failed");
  });
});
