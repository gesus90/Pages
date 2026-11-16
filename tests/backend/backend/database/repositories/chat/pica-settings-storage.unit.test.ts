import { describe, expect, it, vi } from "vitest";

import { PicaSettingsRepository } from "@/backend/database/repositories/chat/PicaSettingsRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

function fixture(): {
  repository: PicaSettingsRepository;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  const transaction = partial<DatabaseTransaction>({ query });
  const database = partial<Database>({
    query,
    transaction: async <Result>(
      work: (activeTransaction: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  });
  return { repository: new PicaSettingsRepository(database), query };
}

describe("Pica settings storage", () => {
  it("reads the singleton and model selection", async () => {
    const { repository, query } = fixture();
    query
      .mockResolvedValueOnce([
        [
          1,
          '{"connectionId":"c","model":"m","reasoningEffort":null}',
          null,
          2,
          0,
        ],
      ])
      .mockResolvedValueOnce([[0, null, null, 3, 1]]);
    await expect(repository.read()).resolves.toEqual({
      isEnabled: true,
      selection: { connectionId: "c", model: "m", reasoningEffort: null },
      run: null,
      revision: 2,
      legacyChecked: false,
    });
    await expect(repository.read()).resolves.toMatchObject({
      isEnabled: false,
      selection: null,
      legacyChecked: true,
    });
  });

  it("rejects missing rows and invalid selections", async () => {
    const { repository, query } = fixture();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        [
          1,
          '{"connectionId":1,"model":"m","reasoningEffort":null}',
          null,
          0,
          0,
        ],
      ])
      .mockResolvedValueOnce([
        [1, '{"connectionId":"c","model":"m","reasoningEffort":2}', null, 0, 0],
      ]);
    for (let index = 0; index < 3; index += 1)
      await expect(repository.read()).rejects.toThrow();
  });

  it("enforces the saved revision", async () => {
    const { repository, query } = fixture();
    const settings = {
      isEnabled: true,
      selection: { connectionId: "c", model: "m", reasoningEffort: null },
      run: null,
      revision: 2,
    };
    query.mockResolvedValueOnce([[1]]).mockResolvedValueOnce([]);
    await expect(repository.save(settings)).resolves.toBeUndefined();
    await expect(
      repository.save({ ...settings, selection: null }),
    ).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
