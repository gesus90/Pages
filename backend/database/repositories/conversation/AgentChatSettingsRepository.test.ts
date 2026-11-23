import { expect, it, vi } from "vitest";

import { AgentChatSettingsRepository } from "./AgentChatSettingsRepository";

import type { DatabaseValue } from "@/backend/database/Database";

function repositoryOf(rows: DatabaseValue[][]): {
  readonly repository: AgentChatSettingsRepository;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  return { repository: new AgentChatSettingsRepository({ query }), query };
}

it("reads the defaults when the row is missing", async () => {
  const { repository } = repositoryOf([]);
  await expect(repository.read()).resolves.toEqual({
    hourlyMessageLimit: 30,
    scheduledTaskLimit: 20,
    revision: 1,
  });
});

it("reads the stored settings by column position", async () => {
  const { repository } = repositoryOf([[5, BigInt(3), 7]]);
  await expect(repository.read()).resolves.toEqual({
    hourlyMessageLimit: 5,
    revision: 3,
    scheduledTaskLimit: 7,
  });
});

it("saves the settings against the read revision", async () => {
  const { repository, query } = repositoryOf([["1"]]);
  await repository.save({
    hourlyMessageLimit: 4,
    scheduledTaskLimit: 6,
    revision: 2,
  });
  expect(query.mock.calls[0]).toHaveProperty("1", {
    hourly_message_limit: 4,
    scheduled_task_limit: 6,
    revision: 2,
  });
});

it("reports a conflict when the revision changed", async () => {
  const { repository } = repositoryOf([]);
  await expect(
    repository.save({
      hourlyMessageLimit: 4,
      scheduledTaskLimit: 6,
      revision: 2,
    }),
  ).rejects.toMatchObject({ code: "profile_conflict" });
});
