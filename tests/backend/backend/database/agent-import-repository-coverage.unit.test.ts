import { expect, it, vi } from "vitest";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

it("reads a run and source only within the given owner and project", async () => {
  const query = vi
    .fn<DatabaseTransaction["query"]>()
    .mockResolvedValueOnce([["running", "{}"]])
    .mockResolvedValueOnce([["wiki", "page", "hash", 4, "{}", "run"]])
    .mockResolvedValueOnce([]);
  const execute = vi.fn<DatabaseTransaction["execute"]>();
  const repository = new AgentImportRepository({ query, execute });
  await expect(
    repository.findRun("run", "user", "project"),
  ).resolves.toMatchObject({ id: "run", status: "running" });
  expect(query.mock.calls[0]?.[1]).toEqual({
    id: "run",
    user_id: "user",
    project_id: "project",
  });
  await expect(
    repository.findSource("project", "source"),
  ).resolves.toMatchObject({ targetId: "page", targetRevision: 4 });
  await expect(
    repository.findRun("missing", "user", "project"),
  ).resolves.toBeNull();
});

it("records a source outcome and finishes partial when conflicts remain", async () => {
  const query = vi
    .fn<DatabaseTransaction["query"]>()
    .mockResolvedValue([[1, 2, 1, 0]]);
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const repository = new AgentImportRepository({ query, execute });
  const item = {
    sourceKey: "source",
    targetKey: "target",
    action: "created" as const,
    pageId: "page",
    link: null,
    assets: [],
    errorCode: null,
  };
  await repository.recordItem("run", 0, item);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    run_id: "run",
    target_id: "page",
    result_json: JSON.stringify(item),
  });
  await expect(repository.finishRun("run")).resolves.toEqual({
    created: 1,
    skipped: 2,
    conflict: 1,
    failed: 0,
  });
  expect(execute.mock.calls.at(-1)?.[1]).toMatchObject({
    id: "run",
    status: "partial",
  });
});

it("refuses to finish when counts are unavailable", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  const execute = vi.fn<DatabaseTransaction["execute"]>();
  await expect(
    new AgentImportRepository({ query, execute }).finishRun("run"),
  ).rejects.toThrow("Import counts unavailable");
  expect(execute).not.toHaveBeenCalled();
});
