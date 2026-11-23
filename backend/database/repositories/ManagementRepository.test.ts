import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { ManagementRepository } from "./ManagementRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

interface Harness {
  readonly execute: Mock;
  readonly query: Mock;
  readonly repository: ManagementRepository;
}

function repositoryOf(rows: unknown[][] = []): Harness {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async () => rows);
  return {
    execute,
    query,
    repository: new ManagementRepository({
      execute,
      query,
    } as unknown as DatabaseTransaction),
  };
}

it("lists project memberships", async () => {
  const { repository } = repositoryOf([["p", "Project", "owner"]]);
  await expect(repository.projects("u")).resolves.toEqual([
    { id: "p", name: "Project", role: "owner" },
  ]);
});

it("reads a stored group description", async () => {
  const { repository } = repositoryOf([["text"]]);
  await expect(repository.description("g")).resolves.toBe("text");
});

it("returns an empty description without a row", async () => {
  const { repository } = repositoryOf([]);
  await expect(repository.description("g")).resolves.toBe("");
});

it("saves a group description", async () => {
  const { repository, execute } = repositoryOf();
  await repository.setDescription("g", "d");
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO management_metadata"),
    { id: "g", description: "d" },
  );
});
