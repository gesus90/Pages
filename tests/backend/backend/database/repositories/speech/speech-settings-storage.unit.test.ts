import { describe, expect, it, vi } from "vitest";

import { SpeechSettingsRepository } from "@/backend/database/repositories/speech/SpeechSettingsRepository";
import { SpeechSynthesisSettingsRepository } from "@/backend/database/repositories/speech/SpeechSynthesisSettingsRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { Database } from "@/backend/database/Database";

function registerPersistenceSpec<
  Settings extends {
    readonly selection: {
      readonly connectionId: string;
      readonly model: string;
    } | null;
    readonly maxDurationMs: number;
    readonly revision: number;
  },
>(
  name: string,
  createRepository: (database: Database) => {
    read: () => Promise<Settings>;
    save: (settings: Settings) => Promise<void>;
  },
): void {
  it(`validates settings and revisions in ${name}`, async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[null, "model", 1, 2]])
      .mockResolvedValueOnce([["connection", "model", 120000, 3]])
      .mockResolvedValueOnce([[1]])
      .mockResolvedValueOnce([]);
    const repository = createRepository(partial<Database>({ query }));
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

describe("speech settings persistence", () => {
  registerPersistenceSpec(
    SpeechSettingsRepository.name,
    (database) => new SpeechSettingsRepository(database),
  );
  registerPersistenceSpec(
    SpeechSynthesisSettingsRepository.name,
    (database) => new SpeechSynthesisSettingsRepository(database),
  );
});
