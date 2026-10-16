import { expect, it, vi } from "vitest";

import { AgentProjectReadService } from "@/backend/service/agents/AgentProjectReadService";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { OWNER } from "../chat/page48-chat-fixture";

import type { ProjectAccessService } from "@/backend/service/project/ProjectAccessService";
import type { Project } from "@/definition/Project";

function project(id: string, name: string): Project {
  return {
    id,
    departments: [],
    parentId: null,
    name,
    description: "Interne Beschreibung",
    status: "active",
    progress: 40,
    placeholderColor: "#000000",
    hasIcon: false,
    managerId: "manager",
    managerName: "Verwaltung",
    startDate: null,
    targetDate: null,
    notes: "Interne Notizen",
    createdAt: "2026-10-16",
    updatedAt: "2026-10-16",
  };
}

it("lists only identifier, name and status of the visible projects, ordered by name", async () => {
  const findAll = vi.fn<ProjectAccessService["findAll"]>(async () => [
    project("b", "Zeta"),
    project("c", "Alpha"),
    project("a", "Alpha"),
  ]);
  const list = await new AgentProjectReadService({ findAll }).list(OWNER);
  expect(findAll).toHaveBeenCalledWith(OWNER);
  expect(list).toEqual({
    projects: [
      { id: "a", name: "Alpha", status: "active" },
      { id: "c", name: "Alpha", status: "active" },
      { id: "b", name: "Zeta", status: "active" },
    ],
    total: 3,
    truncated: false,
  });
});

it("bounds the list and says that more projects exist", async () => {
  const count = PAGES_AGENT_LIMITS.candidates + 1;
  const findAll = vi.fn<ProjectAccessService["findAll"]>(async () =>
    Array.from({ length: count }, (_, index) =>
      project(`project-${index}`, `Projekt ${String(index).padStart(3, "0")}`),
    ),
  );
  const list = await new AgentProjectReadService({ findAll }).list(OWNER);
  expect(list.projects).toHaveLength(PAGES_AGENT_LIMITS.candidates);
  expect(list.total).toBe(count);
  expect(list.truncated).toBe(true);
});
