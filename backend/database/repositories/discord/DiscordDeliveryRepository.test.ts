import { expect, it, vi } from "vitest";

import { DiscordDeliveryRepository } from "./DiscordDeliveryRepository";

import type { DiscordDatabase } from "./DiscordDatabase";
import type { NewDiscordDelivery } from "./DiscordDeliveryRepository";

function doubleOf(...results: unknown[][][]): {
  repository: DiscordDeliveryRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => results.shift() ?? []);
  const execute = vi.fn(async () => undefined);
  const transaction = vi.fn(
    async (work: (inner: unknown) => Promise<unknown>) =>
      work({ query, execute }),
  );
  return {
    repository: new DiscordDeliveryRepository({
      query,
      execute,
      transaction,
    } as unknown as DiscordDatabase),
    query,
    execute,
  };
}

const DELIVERY: NewDiscordDelivery = {
  id: "d1",
  projectId: "p1",
  eventType: "ticket.created",
  subjectKey: "ABC-1",
  contentJson: "{}",
  now: "now",
};

it("inserts a delivery when nothing waits", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.enqueueDelivery(DELIVERY);

  expect(String(execute.mock.calls[0]?.[0])).toContain("INSERT INTO");
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    id: "d1",
    event_type: "ticket.created",
  });
});

it("merges into a waiting message of the same event", async () => {
  const { repository, execute } = doubleOf([["w1", "ticket.created"]]);

  await repository.enqueueDelivery(DELIVERY);

  expect(String(execute.mock.calls[0]?.[0])).toContain("UPDATE");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    content_json: "{}",
    id: "w1",
    now: "now",
  });
});

it("merges an update into any waiting message", async () => {
  const { repository, execute } = doubleOf([["w1", "ticket.created"]]);

  await repository.enqueueDelivery({
    ...DELIVERY,
    eventType: "ticket.updated",
  });

  expect(String(execute.mock.calls[0]?.[0])).toContain("UPDATE");
});

it("inserts a creation next to a waiting message of another event", async () => {
  const { repository, execute } = doubleOf([["w1", "ticket.updated"]]);

  await repository.enqueueDelivery(DELIVERY);

  expect(String(execute.mock.calls[0]?.[0])).toContain("INSERT INTO");
});

it("claims due deliveries ordered by creation time and order", async () => {
  const row = (id: string, created: string, order: number): unknown[] => [
    id,
    "p1",
    "ticket.created",
    "{}",
    2,
    created,
    order,
  ];
  const { repository, query } = doubleOf([
    row("b", "2", 1),
    row("c", "1", 5),
    row("a", "1", 2),
  ]);

  const claimed = await repository.claimDue("now", "later", 10.7);

  expect(claimed.map((delivery) => delivery.id)).toEqual(["a", "c", "b"]);
  expect(claimed[0]).toEqual({
    id: "a",
    projectId: "p1",
    eventType: "ticket.created",
    contentJson: "{}",
    attempts: 2,
    createdAt: "1",
  });
  expect(String(query.mock.calls[0]?.[0])).toContain("LIMIT 10\n");
});

it("rejects a claimed delivery with an unknown event", async () => {
  const { repository } = doubleOf([["a", "p1", "nope", "{}", 0, "1", 1]]);

  await expect(repository.claimDue("n", "l", 1)).rejects.toThrow(
    'invalid value for "event_type"',
  );
});

it("writes the state changes of a delivery", async () => {
  const { repository, execute } = doubleOf();

  await repository.releaseExpiredLocks("now");
  await repository.markSent("d1", "now");
  await repository.discard("d1");
  await repository.reschedule("d1", {
    attempts: 1,
    nextAttemptAt: "next",
    problem: null,
    now: "now",
  });
  await repository.markFailed("d1", {
    attempts: 3,
    problem: "bot_removed",
    now: "now",
  });
  await repository.purge({ sentBefore: "s", failedBefore: "f" });

  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { now: "now" },
    { id: "d1", now: "now" },
    { id: "d1" },
    {
      attempts: 1,
      id: "d1",
      last_problem: null,
      next_attempt_at: "next",
      now: "now",
    },
    { attempts: 3, id: "d1", last_problem: "bot_removed", now: "now" },
    { failed_before: "f", sent_before: "s" },
  ]);
});

it("summarizes counts and the standing problem", async () => {
  const { repository, query } = doubleOf(
    [[2n, 1, "sent"]],
    [["missing_access"]],
  );

  await expect(repository.summarize("p1")).resolves.toEqual({
    pending: 2,
    failed: 1,
    lastSentAt: "sent",
    lastProblem: "missing_access",
  });
  expect(query.mock.calls[1]?.[1]).toEqual({ after: "sent", project_id: "p1" });
});

it("summarizes without rows, problems or a known problem name", async () => {
  const none = doubleOf([], []);
  await expect(none.repository.summarize("p1")).resolves.toEqual({
    pending: 0,
    failed: 0,
    lastSentAt: null,
    lastProblem: null,
  });
  expect(none.query.mock.calls[1]?.[1]).toEqual({
    after: "",
    project_id: "p1",
  });

  const odd = doubleOf([[0, 0, null]], [["weird"]]);
  await expect(odd.repository.summarize("p1")).resolves.toMatchObject({
    lastProblem: "unknown",
  });

  const nullProblem = doubleOf([[0, 0, null]], [[null]]);
  await expect(nullProblem.repository.summarize("p1")).resolves.toMatchObject({
    lastProblem: null,
  });
});
