import { describe, expect, it, vi } from "vitest";

import {
  readPlanContext,
  readPlanPage,
} from "@/backend/service/agents/AgentPlanPage";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PlanPageDependencies } from "@/backend/service/agents/AgentPlanPage";

function fixture(): {
  dependencies: PlanPageDependencies;
  detailed: ReturnType<typeof vi.fn>;
  workspaces: ReturnType<typeof vi.fn>;
} {
  const detailed = vi.fn();
  const workspaces = vi.fn().mockResolvedValue([{ id: "workspace" }]);
  const dependencies = partial<PlanPageDependencies>({
    service: partial({
      summaries: vi.fn().mockResolvedValue([]),
      workspaces,
      detailedView: detailed,
      team: vi
        .fn()
        .mockResolvedValue({ isAdministrator: true, departmentId: "d" }),
      sources: vi.fn().mockResolvedValue({ agents: ["a"], tasks: [] }),
      directory: vi.fn().mockResolvedValue([]),
    }),
    runs: partial({}),
  });
  return { dependencies, detailed, workspaces };
}

describe("plan page context", () => {
  it("loads workspace choices and empty context without a selection", async () => {
    const { dependencies } = fixture();
    await expect(
      readPlanPage(dependencies, "u", { planId: null, workspaceId: null }),
    ).resolves.toMatchObject({
      userId: "u",
      isAdministrator: true,
      teamDepartmentId: "d",
      selected: null,
      sources: { agents: [], tasks: [] },
      runs: [],
    });
    await expect(
      readPlanContext(dependencies, "u", {
        planId: null,
        workspaceId: "workspace",
      }),
    ).resolves.toMatchObject({ sources: { agents: ["a"] } });
  });

  it("refuses inaccessible workspaces while allowing repairable missing registrations", async () => {
    const { dependencies, detailed } = fixture();
    await expect(
      readPlanContext(dependencies, "u", {
        planId: null,
        workspaceId: "other",
      }),
    ).rejects.toThrow();
    detailed.mockResolvedValue({
      id: "plan",
      workspaceId: "other",
      isWorkspaceMissing: true,
    });
    await expect(
      readPlanContext(dependencies, "u", { planId: "plan", workspaceId: null }),
    ).resolves.toMatchObject({
      selected: { id: "plan", isWorkspaceMissing: true },
      sources: { agents: [], tasks: [] },
    });
  });
});
