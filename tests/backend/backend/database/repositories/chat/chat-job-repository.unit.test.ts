import { expect, it, vi } from "vitest";

import { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { Database } from "@/backend/database/Database";

it("projects context, partial token usage and estimated session cost for an owned job", async () => {
  const query = vi.fn(async (statement: string, parameters: unknown) => {
    expect(statement).toContain("chat_jobs.user_id");
    expect(parameters).toEqual({ id: "job", user_id: "user" });
    return [
      [
        "job",
        "session",
        "running",
        null,
        "created",
        null,
        10,
        100,
        0.25,
        "USD",
        null,
        4,
        9,
        1,
        1,
        "session",
      ],
    ];
  });
  const repository = new ChatJobRepository(partial<Database>({ query }));
  await expect(repository.find("user", "job")).resolves.toMatchObject({
    id: "job",
    usage: {
      context: { used: 10, size: 100 },
      tokens: { input: 0, output: 4, total: 9, isPartial: true },
      cost: {
        amount: 0.25,
        currency: "USD",
        isEstimated: true,
        scope: "session",
      },
    },
  });
});

it("reports unavailable usage as null and refuses unknown job states", async () => {
  const row = [
    "job",
    "session",
    "running",
    null,
    "created",
    null,
    null,
    100,
    null,
    null,
    null,
    null,
    null,
    0,
    null,
    null,
  ];
  const query = vi.fn(async () => [row]);
  const repository = new ChatJobRepository(partial<Database>({ query }));
  await expect(repository.latest("user", "session")).resolves.toMatchObject({
    usage: { context: null, tokens: null, cost: null },
  });
  row[2] = "unknown";
  await expect(repository.latest("user", "session")).rejects.toThrow(
    "Invalid chat job state",
  );
});

it("interrupts abandoned jobs in a single transaction and journals each ending", async () => {
  const query = vi.fn(async () => [["b"], ["a"]]);
  const execute = vi.fn(async () => {});
  const transaction = partial<Database>({ query, execute });
  const database = partial<Database>({
    transaction: async (
      work: (value: Database) => Promise<readonly string[]>,
    ) => work(transaction),
  });
  await expect(
    new ChatJobRepository(database).interruptRunning(),
  ).resolves.toEqual(["a", "b"]);
  expect(execute).toHaveBeenCalledTimes(4);
});
