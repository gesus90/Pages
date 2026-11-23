import { expect, it, vi } from "vitest";

import { AgentRunDiagnosisSettingsRepository } from "./AgentRunDiagnosisSettingsRepository";

it("reads the stored settings", async () => {
  const query = vi.fn(async () => [[7, 20, 4]]);

  await expect(
    new AgentRunDiagnosisSettingsRepository({ query }).read(),
  ).resolves.toEqual({ logRetentionDays: 7, stallMinutes: 20, revision: 4 });
});

it("falls back to the defaults without a row", async () => {
  const query = vi.fn(async () => []);

  await expect(
    new AgentRunDiagnosisSettingsRepository({ query }).read(),
  ).resolves.toEqual({ logRetentionDays: 30, stallMinutes: 15, revision: 1 });
});

it("saves the settings at their revision", async () => {
  const query = vi.fn<
    (statement: string, parameters?: unknown) => Promise<number[][]>
  >(async () => [[1]]);

  await new AgentRunDiagnosisSettingsRepository({ query }).save({
    logRetentionDays: 7,
    stallMinutes: 20,
    revision: 4,
  });

  expect(query.mock.calls[0]?.[1]).toEqual({
    log_retention_days: 7,
    stall_minutes: 20,
    revision: 4,
  });
});

it("reports a conflict when the revision changed", async () => {
  const query = vi.fn(async () => []);

  await expect(
    new AgentRunDiagnosisSettingsRepository({ query }).save({
      logRetentionDays: 7,
      stallMinutes: 20,
      revision: 4,
    }),
  ).rejects.toMatchObject({ code: "profile_conflict" });
});
