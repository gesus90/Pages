import { describe, expect, it, vi } from "vitest";

import { SpeechSettingsRepository } from "./SpeechSettingsRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: SpeechSettingsRepository;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  return {
    repository: new SpeechSettingsRepository({ query } as unknown as Database),
    query,
  };
}

describe("SpeechSettingsRepository.read", () => {
  it("maps a stored selection and a valid duration", async () => {
    const { repository, query } = doubleOf([["c1", "m1", 60_000, 3]]);

    await expect(repository.read()).resolves.toEqual({
      selection: { connectionId: "c1", model: "m1" },
      maxDurationMs: 60_000,
      revision: 3,
    });
    expect(query.mock.calls[0]?.[0]).toContain("speech_recognition_settings");
  });

  it.each([
    [null, "m1"],
    ["c1", null],
  ])("reports no selection for %s and %s", async (connection, model) => {
    const { repository } = doubleOf([[connection, model, 60_000, 1]]);

    await expect(repository.read()).resolves.toMatchObject({
      selection: null,
    });
  });

  it("falls back to the default for a duration outside the choices", async () => {
    const { repository } = doubleOf([[null, null, 12_345, 0]]);

    await expect(repository.read()).resolves.toMatchObject({
      maxDurationMs: 120_000,
    });
  });

  it("rejects a missing row as an invalid profile", async () => {
    const { repository } = doubleOf([]);

    await expect(repository.read()).rejects.toMatchObject({
      code: "profile_invalid",
    });
  });
});

describe("SpeechSettingsRepository.save", () => {
  it("writes the selection with the revision it was read at", async () => {
    const { repository, query } = doubleOf([["1"]]);

    await repository.save({
      selection: { connectionId: "c1", model: "m1" },
      maxDurationMs: 300_000,
      revision: 4,
    });

    expect(query.mock.calls[0]?.[1]).toEqual({
      connection_id: "c1",
      model: "m1",
      max_duration_ms: 300_000,
      revision: 4,
    });
  });

  it("stores null columns when nothing is selected", async () => {
    const { repository, query } = doubleOf([["1"]]);

    await repository.save({
      selection: null,
      maxDurationMs: 60_000,
      revision: 0,
    });

    expect(query.mock.calls[0]?.[1]).toMatchObject({
      connection_id: null,
      model: null,
    });
  });

  it("reports a conflict when the revision no longer matches", async () => {
    const { repository } = doubleOf([]);

    await expect(
      repository.save({ selection: null, maxDurationMs: 60_000, revision: 1 }),
    ).rejects.toMatchObject({ code: "profile_conflict" });
  });
});
