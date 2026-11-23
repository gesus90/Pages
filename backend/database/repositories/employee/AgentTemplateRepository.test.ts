import { expect, it, vi } from "vitest";

import { AgentTemplateRepository } from "./AgentTemplateRepository";

import type { DatabaseValue } from "@/backend/database/Database";

const ROW: DatabaseValue[] = ["t1", "Name", "Desc", "Body", 1, "c", "u"];

function doubleOf(rows: DatabaseValue[][]): {
  repository: AgentTemplateRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentTemplateRepository({
      query,
      execute,
    }),
    query,
    execute,
  };
}

it("lists templates", async () => {
  const { repository } = doubleOf([ROW]);

  expect(await repository.list()).toEqual([
    {
      id: "t1",
      name: "Name",
      description: "Desc",
      content: "Body",
      isDefault: true,
      createdAt: "c",
      updatedAt: "u",
    },
  ]);
});

it("finds a template or null", async () => {
  const found = doubleOf([ROW]);
  const missing = doubleOf([]);

  expect((await found.repository.find("t1"))?.id).toBe("t1");
  expect(found.query.mock.calls[0]?.[1]).toEqual({ id: "t1" });
  expect(await missing.repository.find("x")).toBeNull();
});

it("inserts a template with a case-folded name key", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.insert({
    id: "t1",
    name: "ABC",
    description: "d",
    content: "c",
    isDefault: false,
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "t1",
    name: "ABC",
    name_key: "abc",
    description: "d",
    content: "c",
    is_default: false,
  });
});

it("reports whether update and remove hit a row", async () => {
  const hit = doubleOf([["t1"]]);
  const miss = doubleOf([]);
  const input = { name: "N", description: "d", content: "c" };

  expect(await hit.repository.update("t1", input)).toBe(true);
  expect(hit.query.mock.calls[0]?.[1]).toEqual({
    id: "t1",
    name: "N",
    name_key: "n",
    description: "d",
    content: "c",
  });
  expect(await miss.repository.update("t1", input)).toBe(false);
  expect(await hit.repository.remove("t1")).toBe(true);
  expect(await miss.repository.remove("t1")).toBe(false);
});

it("reads the seeding state", async () => {
  expect(await doubleOf([]).repository.isSeeded()).toBe(true);
  expect(await doubleOf([[1]]).repository.isSeeded()).toBe(true);
  expect(await doubleOf([[0]]).repository.isSeeded()).toBe(false);
});

it("claims the seeding once", async () => {
  expect(await doubleOf([[1]]).repository.claimSeeding()).toBe(true);
  expect(await doubleOf([]).repository.claimSeeding()).toBe(false);
});
