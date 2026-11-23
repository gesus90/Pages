import { expect, it, vi, type Mock } from "vitest";

import { ConversationEmbedDomainRepository } from "./ConversationEmbedDomainRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

type EmbedDatabase = Pick<Database, "query" | "execute">;

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly repository: ConversationEmbedDomainRepository;
  readonly execute: Mock<Database["execute"]>;
  readonly query: Mock<Database["query"]>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  const database: EmbedDatabase = { execute, query };
  return {
    repository: new ConversationEmbedDomainRepository(database),
    execute,
    query,
  };
}

const release = {
  domain: "example.test",
  addedBy: "u1",
  createdAt: "2026-01-01T00:00:00Z",
};

it("groups the released domains by conversation", async () => {
  const { repository, query } = databaseOf([
    ["c1", "a.test"],
    ["c1", "b.test"],
    ["c2", "c.test"],
  ]);
  await expect(repository.forConversations(["c1", "c2"])).resolves.toEqual(
    new Map([
      ["c1", ["a.test", "b.test"]],
      ["c2", ["c.test"]],
    ]),
  );
  expect(query.mock.calls[0]?.[1]).toEqual({
    conversation_0: "c1",
    conversation_1: "c2",
  });
});

it("does not query without conversations", async () => {
  const { repository, query } = databaseOf();
  await expect(repository.forConversations([])).resolves.toEqual(new Map());
  expect(query).not.toHaveBeenCalled();
});

it("releases a domain for one conversation", async () => {
  const { repository, execute } = databaseOf();
  await repository.add("c1", release);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    domain: "example.test",
    added_by: "u1",
    created_at: "2026-01-01T00:00:00Z",
  });
});

it("takes a domain from one conversation", async () => {
  const { repository, execute } = databaseOf();
  await repository.remove("c1", "example.test");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    domain: "example.test",
  });
});

it("reads the global domains", async () => {
  const { repository } = databaseOf([["a.test"], ["b.test"]]);
  await expect(repository.global()).resolves.toEqual(["a.test", "b.test"]);
});

it("releases and removes a global domain", async () => {
  const { repository, execute } = databaseOf();
  await repository.addGlobal(release);
  await repository.removeGlobal("example.test");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    domain: "example.test",
    added_by: "u1",
    created_at: "2026-01-01T00:00:00Z",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({ domain: "example.test" });
});
