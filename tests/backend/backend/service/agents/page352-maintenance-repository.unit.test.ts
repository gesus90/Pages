import { expect, it, vi } from "vitest";

import { AgentEnvironmentRepository } from "@/backend/database/repositories/agent/AgentEnvironmentRepository";
import { AgentDeferredGarbage } from "@/backend/storage/AgentDeferredGarbage";

import { environmentFiles as files } from "./page352-files";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

vi.mock("node:fs/promises", async () => {
  const { environmentFiles } = await import("./page352-files");
  return environmentFiles.module();
});

it("holds the plan lock while emptying settled homes and retains active/recoverable runs and leases", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>();
  const execute = vi.fn<DatabaseTransaction["execute"]>();
  const transaction: Database["transaction"] = async (task) =>
    task({ query, execute });
  const repository = new AgentEnvironmentRepository({ query, transaction });
  const maintain = vi.fn(async () => undefined);
  query.mockResolvedValueOnce([["plan"]]).mockResolvedValueOnce([]);
  await repository.maintainPlan("plan", maintain);
  expect(maintain).toHaveBeenCalledWith("empty");
  expect(query.mock.calls[0]?.[0]).toContain("FOR UPDATE");
  maintain.mockClear();
  query
    .mockResolvedValueOnce([["plan"]])
    .mockResolvedValueOnce([["active-run"]]);
  await repository.maintainPlan("plan", maintain);
  expect(maintain).not.toHaveBeenCalled();
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  await repository.maintainPlan("deleted-plan", maintain);
  expect(maintain).toHaveBeenCalledWith("remove");
  query.mockResolvedValueOnce([["active-run"]]).mockResolvedValueOnce([]);
  expect(await repository.canRemoveRun("active-run")).toBe(false);
  expect(await repository.canRemoveRun("settled-run")).toBe(true);
});

it("processes a plan deletion intent across every connection without touching another plan", async () => {
  files.reset();
  const plan = "11111111-1111-4111-8111-111111111111";
  const intent = `plan-homes/${plan}/`;
  for (const connection of ["one", "two"]) {
    files.seed(
      `/memory/agents/${connection}/plan-homes/${plan}/scope/home/transcript`,
      "file",
    );
    files.seed(
      `/memory/agents/${connection}/plan-homes/other-plan/scope/home/transcript`,
      "file",
    );
  }
  const query = vi
    .fn<DatabaseTransaction["query"]>()
    .mockResolvedValueOnce([[intent]])
    .mockResolvedValue([]);
  const execute = vi.fn<DatabaseTransaction["execute"]>();
  const transaction: Database["transaction"] = async (task) =>
    task({ query, execute });
  const garbage = new AgentDeferredGarbage({
    directory: "/memory",
    removePayload: async () => undefined,
  });
  garbage.schedule({ query, execute, transaction });
  await garbage.idle();
  expect(
    [...files.entries.keys()].some((entry) =>
      entry.includes(`/plan-homes/${plan}/`),
    ),
  ).toBe(false);
  expect(
    [...files.entries.keys()].filter((entry) => entry.endsWith("/transcript")),
  ).toHaveLength(2);
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("DELETE FROM agent_payload_garbage"),
    { storage_name: intent },
  );
  await garbage.close();
});
