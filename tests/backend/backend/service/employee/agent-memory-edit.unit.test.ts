import { expect, it, vi } from "vitest";

import { AgentMemoryService } from "@/backend/service/employee/AgentMemoryService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";

it("edits memory only when it changes and records a version", async () => {
  const employee = {
    memory: "old",
    dream: "dream",
    memoryCharacters: 20,
    dreamCharacters: 20,
  };
  const saveMemory = vi.fn(async () => {});
  const addVersion = vi.fn(async () => {});
  const pruneVersions = vi.fn(async () => {});
  const store = partial<EmployeeStore>({
    employees: () => ({ find: async () => employee, saveMemory }),
    memory: () => ({ archive: async () => [], addVersion, pruneVersions }),
  });
  const service = new AgentMemoryService(store);
  await service.edit(store, {
    agentId: "agent",
    file: "memory",
    text: " old ",
    actorId: "person",
  });
  expect(saveMemory).not.toHaveBeenCalled();
  await service.edit(store, {
    agentId: "agent",
    file: "memory",
    text: " new ",
    actorId: "person",
  });
  expect(saveMemory).toHaveBeenCalledWith("agent", "new");
  expect(addVersion).toHaveBeenCalledWith(
    expect.objectContaining({ reason: "edit", createdBy: "person" }),
  );
  expect(pruneVersions).toHaveBeenCalledWith("agent", 50);
  await expect(
    service.edit(store, {
      agentId: "agent",
      file: "memory",
      text: "a".repeat(21),
      actorId: "person",
    }),
  ).rejects.toMatchObject({ code: "invalidInput" });
});

it("restores the two files and only valid archive entries", async () => {
  const saveMemory = vi.fn(async () => {});
  const saveDream = vi.fn(async () => {});
  const add = vi.fn(async (agentId: string, entries: readonly unknown[]) => {
    expect(agentId).toBe("agent");
    expect(entries).toHaveLength(1);
  });
  const clear = vi.fn(async () => {});
  const repository = {
    findVersion: async () => ({
      memory: "prior",
      dream: "lesson",
      archive: JSON.stringify([
        {
          id: "one",
          title: "Title",
          content: "Content",
          createdAt: "2026-01-01",
        },
        { title: "invalid" },
      ]),
    }),
    clear,
    add,
    archive: async () => [],
    addVersion: async () => {},
    pruneVersions: async () => {},
  };
  const employees = {
    touch: async () => true,
    saveMemory,
    saveDream,
    find: async () => ({ memory: "prior", dream: "lesson" }),
  };
  const store = partial<EmployeeStore>({
    employees: () => employees,
    memory: () => repository,
  });
  const transactional = partial<EmployeeStore>({
    transaction: async (work: (value: EmployeeStore) => Promise<void>) =>
      work(store),
  });
  await new AgentMemoryService(transactional).restore(
    "agent",
    { id: "version", expectedRevision: 4 },
    "actor",
  );
  expect(saveMemory).toHaveBeenCalledWith("agent", "prior");
  expect(saveDream).toHaveBeenCalledWith("agent", "lesson");
  expect(clear).toHaveBeenCalledWith("agent");
  expect(add).toHaveBeenCalledOnce();
});
