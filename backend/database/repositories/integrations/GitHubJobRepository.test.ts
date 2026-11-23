import { describe, expect, it, vi } from "vitest";

import { GitHubJobRepository } from "./GitHubJobRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][] = []): {
  repository: GitHubJobRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new GitHubJobRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

const IMPORT = {
  operation: "import",
  actorId: "u1",
  targetId: "p1",
  issueNumber: 3,
} as const;

describe("GitHubJobRepository.enqueue", () => {
  it("stores the validated command and returns the row id", async () => {
    const { repository, query } = doubleOf([["job-1"]]);

    await expect(repository.enqueue(IMPORT, "dedupe")).resolves.toBe("job-1");

    const parameters = query.mock.calls[0]?.[1] as Record<string, string>;
    expect(JSON.parse(parameters.command ?? "")).toEqual(IMPORT);
    expect(parameters.deduplication_key).toBe("dedupe");
  });

  it("defaults to no deduplication key", async () => {
    const { repository, query } = doubleOf([["job-1"]]);

    await repository.enqueue({ operation: "scheduled" });

    expect(query.mock.calls[0]?.[1]).toMatchObject({ deduplication_key: null });
  });

  it("rejects an insert that returned no row", async () => {
    const { repository } = doubleOf([]);

    await expect(
      repository.enqueue({ operation: "scheduled" }),
    ).rejects.toThrow('invalid value for "id"');
  });
});

describe("GitHubJobRepository.claim", () => {
  it("returns the parsed job", async () => {
    const { repository } = doubleOf([["j1", JSON.stringify(IMPORT), 2]]);

    await expect(repository.claim()).resolves.toEqual({
      id: "j1",
      command: IMPORT,
      attempts: 2,
    });
  });

  it("returns null when no job is due", async () => {
    await expect(doubleOf([]).repository.claim()).resolves.toBeNull();
  });
});

describe("GitHubJobRepository.result", () => {
  it("parses a stored reply", async () => {
    const { repository, query } = doubleOf([
      ["done", JSON.stringify({ kind: "task", id: "t1" })],
    ]);

    await expect(repository.result("j1")).resolves.toEqual({
      kind: "task",
      id: "t1",
    });
    expect(query.mock.calls[0]?.[1]).toEqual({ id: "j1" });
  });

  it("returns null while no reply is stored", async () => {
    await expect(
      doubleOf([["running", null]]).repository.result("j1"),
    ).resolves.toBeNull();
  });

  it("reports an uncertain outcome", async () => {
    await expect(
      doubleOf([["uncertain", null]]).repository.result("j1"),
    ).resolves.toEqual({
      kind: "error",
      code: "integration_outcome_uncertain",
    });
  });

  it("rejects an unknown job", async () => {
    await expect(doubleOf([]).repository.result("j1")).rejects.toThrow(
      "GitHub job is unavailable.",
    );
  });
});

describe("GitHubJobRepository writes", () => {
  it("recovers running jobs", async () => {
    const { repository, execute } = doubleOf();

    await repository.recover();

    expect(execute.mock.calls[0]?.[0]).toContain("'uncertain'");
  });

  it.each([
    [{ kind: "error", code: "x" } as const, "failed"],
    [{ kind: "void" } as const, "done"],
  ])("finishes %j as %s", async (result, state) => {
    const { repository, execute } = doubleOf();

    await repository.finish("j1", result);

    expect(execute.mock.calls[0]?.[1]).toEqual({
      id: "j1",
      state,
      result: JSON.stringify(result),
    });
  });

  it("retries with a persisted delay", async () => {
    const { repository, execute } = doubleOf();

    await repository.retry("j1", 30);

    expect(execute.mock.calls[0]?.[1]).toEqual({ id: "j1", seconds: 30 });
  });

  it("prunes old terminal replies", async () => {
    const { repository, execute } = doubleOf();

    await repository.prune();

    expect(execute.mock.calls[0]?.[0]).toContain("DELETE FROM");
  });
});
