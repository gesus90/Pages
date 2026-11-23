import { expect, it, vi } from "vitest";

import { AgentTemplateRepository } from "./AgentTemplateRepository";
import { ChatGroupRepository } from "./ChatGroupRepository";
import { EmployeeStore } from "./EmployeeStore";

import type { Database } from "@/backend/database/Database";

const ACCESSORS = [
  "employees",
  "memory",
  "templates",
  "activity",
  "identities",
  "conversations",
  "chatSessions",
  "chatModels",
  "sessionControllers",
  "logbook",
  "dreaming",
  "recipes",
  "toolUses",
  "logbookSessions",
  "chats",
  "sessionSettings",
  "contacts",
  "groups",
  "removals",
  "profileLoads",
  "deletions",
  "deletionPurges",
  "sources",
] as const;

function databaseDouble(): Database {
  return {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(),
  } as unknown as Database;
}

it("creates every repository on demand", () => {
  const store = new EmployeeStore(databaseDouble());

  for (const accessor of ACCESSORS) {
    expect(store[accessor]()).toBeTypeOf("object");
  }
  expect(store.templates()).toBeInstanceOf(AgentTemplateRepository);
  expect(store.groups()).toBeInstanceOf(ChatGroupRepository);
});

it("shares one transaction across the repositories of a scoped store", async () => {
  const query = vi.fn(async () => [["ok"]]);
  const execute = vi.fn(async () => undefined);
  const transaction = { query, execute };
  const database = {
    query: vi.fn(),
    execute: vi.fn(),
    transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(transaction),
  } as unknown as Database;

  const result = await new EmployeeStore(database).transaction(
    async (store) => {
      await store.sessionControllers().remove("c1", "u1");
      const names = await store.sessionControllers().list("c1");
      await store.transaction(async (inner) => {
        await inner.sessionControllers().remove("c1", "u2");
      });
      return names;
    },
  );

  expect(result).toEqual(["ok"]);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(database.query).not.toHaveBeenCalled();
});
