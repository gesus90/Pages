import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsService } from "@/backend/service/SettingsService";
import { LANGUAGE } from "@/language/Language";

import type { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";

function createRepository(): UserSettingsRepository & {
  findLanguageByUserId: ReturnType<typeof vi.fn>;
  upsertLanguage: ReturnType<typeof vi.fn>;
} {
  return {
    findLanguageByUserId: vi.fn(),
    upsertLanguage: vi.fn(),
  } as unknown as UserSettingsRepository & {
    findLanguageByUserId: ReturnType<typeof vi.fn>;
    upsertLanguage: ReturnType<typeof vi.fn>;
  };
}

describe("SettingsService", () => {
  let repository: ReturnType<typeof createRepository>;
  let service: SettingsService;

  beforeEach(() => {
    repository = createRepository();
    service = new SettingsService(repository);
  });

  it("returns the stored language for a user", async () => {
    repository.findLanguageByUserId.mockResolvedValue(LANGUAGE.ENGLISH);

    await expect(service.getUserSettings("user-1")).resolves.toEqual({
      language: LANGUAGE.ENGLISH,
    });
    expect(repository.findLanguageByUserId).toHaveBeenCalledWith("user-1");
  });

  it("falls back to German without a stored language", async () => {
    repository.findLanguageByUserId.mockResolvedValue(null);

    await expect(service.getUserSettings("user-1")).resolves.toEqual({
      language: LANGUAGE.GERMAN,
    });
  });

  it("propagates lookup failures", async () => {
    repository.findLanguageByUserId.mockRejectedValue(
      new Error("Database unavailable"),
    );

    await expect(service.getUserSettings("user-1")).rejects.toThrow(
      "Database unavailable",
    );
  });

  it("persists language changes", async () => {
    repository.upsertLanguage.mockResolvedValue(undefined);

    await service.updateLanguage("user-1", LANGUAGE.ENGLISH);

    expect(repository.upsertLanguage).toHaveBeenCalledWith(
      "user-1",
      LANGUAGE.ENGLISH,
    );
  });

  it("propagates persistence failures", async () => {
    repository.upsertLanguage.mockRejectedValue(new Error("Write failed"));

    await expect(
      service.updateLanguage("user-1", LANGUAGE.GERMAN),
    ).rejects.toThrow("Write failed");
  });
});
