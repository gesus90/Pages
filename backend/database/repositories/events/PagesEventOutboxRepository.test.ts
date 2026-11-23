import { expect, it, vi } from "vitest";

import { PagesEventOutboxRepository } from "./PagesEventOutboxRepository";

function doubleOf(): {
  repository: PagesEventOutboxRepository;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn<
    (statement: string, parameters?: unknown) => Promise<void>
  >(async () => undefined);
  return { repository: new PagesEventOutboxRepository({ execute }), execute };
}

it("stores a storage event with its usage", async () => {
  const { repository, execute } = doubleOf();
  const storage = {
    totalBytes: 1,
    limitBytes: 2,
    largestDirectoryBytes: [1],
  };

  await repository.append({ type: "storage.usage", id: "s1", storage });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    kind: "storage.usage",
    object_id: "s1",
    storage_usage: JSON.stringify(storage),
  });
});

it("stores an event with its audience", async () => {
  const { repository, execute } = doubleOf();

  await repository.append({
    type: "ticket.deleted",
    id: "t1",
    audience: { projectId: "p1", departmentIds: ["d1"] },
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    kind: "ticket.deleted",
    object_id: "t1",
    audience_project_id: "p1",
    audience_department_ids: '["d1"]',
  });
});

it("stores an event without audience as empty", async () => {
  const { repository, execute } = doubleOf();

  await repository.append({ type: "wiki.changed", id: "w1" });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    kind: "wiki.changed",
    object_id: "w1",
    audience_project_id: null,
    audience_department_ids: "[]",
  });
});
