import { expect, it, vi } from "vitest";

import { AutomationReads } from "@/backend/service/automation/AutomationReads";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AutomationReadDependencies } from "@/backend/service/automation/AutomationReads";

it("offers scripts only to administrators and includes readable plan choices", async () => {
  const workspaces = vi.fn(async () => []);
  const directory = {
    agents: async () => [{ id: "agent" }],
    plans: async () => [{ id: "plan", canStart: true }],
    planSteps: async () => [{ id: "step" }],
    projects: async () => [],
    memberProjects: async () => [],
    groups: async () => [],
    workspaces,
    interpreterProfiles: async () => [],
  };
  const service = new AutomationReads(
    partial<AutomationReadDependencies>({
      access: {
        actor: async () => ({
          id: "user",
          isAdministrator: false,
          timeZone: "Europe/Berlin",
        }),
      },
      directory,
    }),
  );
  const options = await service.options("user");
  expect(options.actions).toEqual([
    { type: "agent", isAllowed: true },
    { type: "script", isAllowed: false },
    { type: "plan", isAllowed: true },
  ]);
  expect(options.plans).toMatchObject([
    { id: "plan", steps: [{ id: "step" }] },
  ]);
  expect(options.workspaces).toEqual([]);
  expect(workspaces).not.toHaveBeenCalled();
});

it("exposes workspace and interpreter options to active administrators", async () => {
  const directory = {
    agents: async () => [],
    plans: async () => [],
    projects: async () => [],
    memberProjects: async () => [],
    groups: async () => [],
    workspaces: async () => [{ id: "work" }],
    interpreterProfiles: async () => [{ id: "python" }],
  };
  const service = new AutomationReads(
    partial<AutomationReadDependencies>({
      access: {
        actor: async () => ({
          id: "admin",
          isAdministrator: true,
          timeZone: "UTC",
        }),
      },
      directory,
    }),
  );
  const options = await service.options("admin");
  expect(options.actions).toEqual([
    { type: "agent", isAllowed: false },
    { type: "script", isAllowed: true },
    { type: "plan", isAllowed: false },
  ]);
  expect(options.workspaces).toMatchObject([{ id: "work" }]);
  expect(options.interpreterProfiles).toMatchObject([{ id: "python" }]);
});
