import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { UserBoardPreferencesRepository } from "./UserBoardPreferencesRepository";

import type { Database } from "@/backend/database/Database";

interface Harness {
  readonly execute: Mock;
  readonly query: Mock;
  readonly repository: UserBoardPreferencesRepository;
}

function repositoryOf(rows: unknown[][] = []): Harness {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async () => rows);
  return {
    execute,
    query,
    repository: new UserBoardPreferencesRepository({
      execute,
      query,
    } as unknown as Database),
  };
}

it("returns stored preferences", async () => {
  const { repository } = repositoryOf([["{}"]]);
  await expect(repository.findByUserId("u")).resolves.toBe("{}");
});

it("returns null without stored preferences", async () => {
  const { repository } = repositoryOf([]);
  await expect(repository.findByUserId("u")).resolves.toBeNull();
});

it("upserts preferences", async () => {
  const { repository, execute } = repositoryOf();
  await repository.upsert("u", "p");
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO user_board_preferences"),
    { preferences: "p", user_id: "u" },
  );
});
