import { describe, expect, it, vi } from "vitest";

import { SpeechSettingsRepository } from "@/backend/database/repositories/speech/SpeechSettingsRepository";
import { SpeechSynthesisSettingsRepository } from "@/backend/database/repositories/speech/SpeechSynthesisSettingsRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { Database } from "@/backend/database/Database";

describe("speech settings persistence", () => {
  for (const Repository of [
    SpeechSettingsRepository,
    SpeechSynthesisSettingsRepository,
  ]) {
    it(`validates settings and revisions in ${Repository.name}`, async () => {
      const query = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([[null, "model", 1, 2]])
        .mockResolvedValueOnce([["connection", "model", 120000, 3]])
        .mockResolvedValueOnce([[1]])
        .mockResolvedValueOnce([]);
      const repository = new Repository(partial<Database>({ query }));
      await expect(repository.read()).rejects.toThrow();
      await expect(repository.read()).resolves.toEqual({
        selection: null,
        maxDurationMs: 120000,
        revision: 2,
      });
      const settings = await repository.read();
      expect(settings).toEqual({
        selection: { connectionId: "connection", model: "model" },
        maxDurationMs: 120000,
        revision: 3,
      });
      await expect(repository.save(settings)).resolves.toBeUndefined();
      await expect(
        repository.save({ ...settings, selection: null }),
      ).rejects.toThrow();
    });
  }
});
