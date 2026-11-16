import { expect, it, vi } from "vitest";

import { applyAgentProject } from "@/backend/service/agents/AgentProjectOperations";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";

it("rejects invalid project names, status and date ranges before writing", async () => {
  const getById = vi.fn(async () => ({
    name: "Project",
    description: "",
    status: "active",
    progress: 0,
    managerId: null,
    startDate: null,
    targetDate: null,
    notes: "",
  }));
  const context = partial<AgentTaskContext>({
    actor: { id: "user" },
    projects: { getById },
    database: {},
  });
  await expect(
    applyAgentProject(context, "projects.setName", {
      projectId: "project",
      name: "  ",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    applyAgentProject(context, "projects.setStatus", {
      projectId: "project",
      status: "unknown",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    applyAgentProject(context, "projects.setDates", {
      projectId: "project",
      startDate: "2026-02-01",
      targetDate: "2026-01-01",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(getById).toHaveBeenCalledTimes(3);
});

it("rejects invalid create status before constructing a project", async () => {
  const context = partial<AgentTaskContext>({
    actor: { id: "user" },
    database: {},
  });
  await expect(
    applyAgentProject(context, "projects.create", { status: "unknown" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});
