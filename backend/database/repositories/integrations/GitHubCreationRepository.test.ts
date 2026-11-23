import { describe, expect, it, vi } from "vitest";

import { GitHubCreationRepository } from "./GitHubCreationRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][] = []): {
  repository: GitHubCreationRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new GitHubCreationRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

describe("GitHubCreationRepository.find", () => {
  it("returns the confirmed issue number", async () => {
    const { repository, query } = doubleOf([[12]]);

    await expect(repository.find("k1")).resolves.toBe(12);
    expect(query.mock.calls[0]?.[1]).toEqual({ key: "k1" });
  });

  it("returns null for an unknown key", async () => {
    const { repository } = doubleOf([]);

    await expect(repository.find("k1")).resolves.toBeNull();
  });

  it("returns null while the create is not acknowledged", async () => {
    const { repository } = doubleOf([[null]]);

    await expect(repository.find("k1")).resolves.toBeNull();
  });
});

describe("GitHubCreationRepository.begin", () => {
  it("lets only the first attempt through", async () => {
    await expect(doubleOf([["k1"]]).repository.begin("k1")).resolves.toBe(true);
    await expect(doubleOf([]).repository.begin("k1")).resolves.toBe(false);
  });
});

describe("GitHubCreationRepository.confirm", () => {
  it("records the acknowledged issue number", async () => {
    const { repository, execute } = doubleOf();

    await repository.confirm("k1", 7);

    expect(execute.mock.calls[0]?.[1]).toEqual({ key: "k1", number: 7 });
  });
});
