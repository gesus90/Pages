import { expect, it, vi } from "vitest";

import { ConversationDeliveryRepository } from "./ConversationDeliveryRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly repository: ConversationDeliveryRepository;
  readonly execute: ReturnType<typeof vi.fn<Database["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return {
    repository: new ConversationDeliveryRepository({ execute, query }),
    execute,
    query,
  };
}

it("records the confirmed state of a claimed answer", async () => {
  const { repository, execute } = databaseOf();
  await repository.record(
    { originMessageId: "o1", agentId: "a1", triggerMessageId: "t1" },
    { state: "started", updatedAt: "2026-01-01T00:00:00Z" },
  );
  expect(execute.mock.calls[0]?.[1]).toEqual({
    origin_message_id: "o1",
    agent_id: "a1",
    trigger_message_id: "t1",
    delivery: "started",
    updated_at: "2026-01-01T00:00:00Z",
  });
});

it("returns no deliveries without messages", async () => {
  const { repository, query } = databaseOf();
  await expect(repository.forMessages([])).resolves.toEqual(new Map());
  expect(query).not.toHaveBeenCalled();
});

it("groups the deliveries by message and skips unknown values", async () => {
  const { repository } = databaseOf([
    ["m1", "a1", "task", "started"],
    ["m1", "a2", "steer", "queued"],
    ["m2", "a1", "bogus", "started"],
    ["m2", "a1", "task", "bogus"],
  ]);
  await expect(repository.forMessages(["m1", "m2"])).resolves.toEqual(
    new Map([
      [
        "m1",
        [
          { agentId: "a1", intent: "task", state: "started" },
          { agentId: "a2", intent: "steer", state: "queued" },
        ],
      ],
    ]),
  );
});
