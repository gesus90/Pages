import { expect, it, vi } from "vitest";

import { ProjectLifecycleRepository } from "./ProjectLifecycleRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

vi.mock("./ProjectReferenceCleanup", () => ({
  clearProjectReferences: vi.fn<DatabaseTransaction["execute"]>(async () => {}),
}));
vi.mock("./ProjectAgentDeletion", () => ({
  deleteProjectAgentData: vi.fn(async () => [{ agentId: "a", runId: "r" }]),
}));
vi.mock("./ProjectWorkItemDeletion", () => ({
  deleteProjectWorkItemData: vi.fn(async () => ["t.bin"]),
}));
vi.mock("./ProjectWikiDeletion", () => ({
  deleteProjectWiki: vi.fn(async () => ["w.bin"]),
}));

it("deletes owned rows, detaches children and returns the files", async () => {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const database: DatabaseTransaction = { execute, query: async () => [] };
  const files = await new ProjectLifecycleRepository(database).delete("p1");
  expect(files).toEqual({
    agentRunRecords: [{ agentId: "a", runId: "r" }],
    ticketAttachments: ["t.bin"],
    wikiAttachments: ["w.bin"],
  });
  const statements = execute.mock.calls.map((call) => String(call[0]));
  expect(statements.at(-1)).toContain("DELETE FROM projects");
  expect(statements.at(-2)).toContain("parent_id = NULL");
  expect(
    statements.filter((text) => text.includes("project_templates")),
  ).toHaveLength(3);
});
