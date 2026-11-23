import { expect, it, vi, type Mock } from "vitest";

import { ChatAnswerModelRepository } from "./ChatAnswerModelRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { AgentAnswerModel } from "@/definition/AgentChatControl";

const MODEL: AgentAnswerModel = {
  name: "Model",
  provider: "openrouter",
  modelId: "m1",
  reasoningEffort: "high",
  modelStatus: "confirmed",
  reasoningStatus: "requested",
  isFree: false,
};

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Database;
  readonly execute: Mock;
  readonly query: Mock;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);
  const transaction = vi.fn(
    async (work: (inner: { execute: typeof execute }) => Promise<void>) => {
      await work({ execute });
    },
  );
  const database = { query, transaction } as unknown as Database;
  return { database, execute, query };
}

it("records the model on both message tables", async () => {
  const { database, execute } = databaseOf();
  await new ChatAnswerModelRepository(database).record("m", MODEL);
  expect(execute).toHaveBeenCalledTimes(2);
  const parameters = execute.mock.calls[0] as unknown as [
    string,
    { id: string; answer_model: string },
  ];
  expect(parameters[1].id).toBe("m");
  expect(JSON.parse(parameters[1].answer_model)).toEqual(MODEL);
});

it("returns an empty map without querying for no ids", async () => {
  const { database, query } = databaseOf();
  const models = await new ChatAnswerModelRepository(database).forMessages([]);
  expect(models.size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});

it("reads stored models and skips unreadable ones", async () => {
  const { database, query } = databaseOf([
    ["a", JSON.stringify(MODEL)],
    ["b", "{broken"],
    ["c", JSON.stringify({ name: 1 })],
    [
      "d",
      JSON.stringify({
        ...MODEL,
        provider: "unknown",
        modelStatus: "bogus",
      }),
    ],
  ]);
  const models = await new ChatAnswerModelRepository(database).forMessages([
    "a",
    "b",
  ]);
  expect([...models.keys()]).toEqual(["a", "d"]);
  expect(models.get("a")).toEqual(MODEL);
  expect(models.get("d")?.provider).toBeNull();
  expect(models.get("d")?.modelStatus).toBeUndefined();
  expect(query.mock.calls[0]).toHaveProperty("1", { ids: "a,b" });
});
