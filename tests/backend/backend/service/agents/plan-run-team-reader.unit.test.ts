import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanRunTeamReader } from "@/backend/service/agents/diagnosis/AgentPlanRunTeamReader";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PlanRunReadDependencies } from "@/backend/service/agents/AgentPlanRunReader";

const find = vi.fn();
const resources = vi.fn();
const requirePlan = vi.fn();
const requireReadable = vi.fn();
const requireWiki = vi.fn();
const requireAccess = vi.fn();
const displayName = vi.fn();
const dependencies = partial<PlanRunReadDependencies>({
  runs: { find, resources },
  access: { require: requirePlan },
  tasks: { requireReadable },
  parameters: { requireWiki },
  workspaces: { requireAccess },
});
const reader = new AgentPlanRunTeamReader(dependencies, { displayName });
const run = {
  id: "run",
  planId: "plan",
  userId: "starter",
  status: "failed",
  steps: [
    { id: "step", name: "Secret ticket", status: "failed", output: "secret" },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  find.mockResolvedValue(run);
  requirePlan.mockResolvedValue({
    id: "plan",
    rights: { canReadAllRuns: false },
  });
  resources.mockResolvedValue({
    projectId: "project",
    taskIds: ["ticket"],
    ticketIds: [],
    wikiIds: [],
    workspaceIds: [],
    ticketAssets: [],
    stepTickets: { step: ["ticket"] },
  });
  displayName.mockResolvedValue("Starter");
});

it("shows a team reader the stored run when all resources are visible", async () => {
  const result = await reader.read("member", "run");
  expect(result).toMatchObject({
    startedBy: { id: "starter", displayName: "Starter" },
    hiddenFields: [],
    hiddenSources: [],
    run: { steps: [{ name: "Secret ticket", output: "secret" }] },
  });
});

it("redacts content and ticket-derived step names after access is lost", async () => {
  requireReadable.mockRejectedValue(new AgentError("plan_access_denied"));
  const result = await reader.read("member", "run");
  expect(result.hiddenSources).toEqual(["tickets"]);
  expect(result.hiddenFields).toContain("steps.name");
  expect(result.run.steps[0]).toMatchObject({
    name: "step",
    output: null,
    isDisplayFiltered: true,
  });
});

it("keeps missing runs hidden and propagates infrastructure failures", async () => {
  find.mockResolvedValueOnce(null);
  await expect(reader.read("member", "missing")).rejects.toThrow();
  requireReadable.mockRejectedValueOnce(new Error("storage offline"));
  await expect(reader.read("member", "run")).rejects.toThrow("storage offline");
  displayName.mockResolvedValueOnce(null);
  expect(await reader.describeStarter("gone")).toEqual({
    id: "gone",
    displayName: "gone",
  });
});
