import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanOwnerRunReader } from "@/backend/service/agents/AgentPlanOwnerRunReader";

import { partial } from "../../../app/lib/service-wiring-fakes";
import {
  agent,
  boundary,
  edge,
  planOf,
} from "../../../definition/plan-fixtures";

import type { PlanRunReadDependencies } from "@/backend/service/agents/AgentPlanRunReader";

const find = vi.fn();
const resources = vi.fn();
const snapshot = vi.fn();
const requirePlan = vi.fn();
const team = vi.fn();
const requireReadable = vi.fn();
const reader = new AgentPlanOwnerRunReader(
  partial<PlanRunReadDependencies>({
    runs: { find, resources, snapshot },
    access: { require: requirePlan, team },
    profiles: {},
    workspaces: {},
    tasks: { requireReadable },
    parameters: {},
  }),
);
const run = { id: "run", planId: "plan", userId: "starter", steps: [] };
const plan = {
  ...planOf(
    [boundary("start", "start"), agent("agent"), boundary("end", "end")],
    [edge("start", "agent"), edge("agent", "end")],
  ),
  id: "plan",
  name: "Plan",
  departmentId: "team",
};

beforeEach(() => {
  vi.resetAllMocks();
  find.mockResolvedValue(run);
  requirePlan.mockResolvedValue(plan);
  team.mockResolvedValue({ departmentIds: ["team"] });
  resources.mockResolvedValue({
    agentIds: [],
    workspaceIds: [],
    taskIds: ["ticket"],
    ticketIds: [],
    wikiIds: [],
    ticketAssets: [],
    projectId: "project",
  });
  snapshot.mockResolvedValue({ plan, steps: [] });
});

it("returns only gone for a missing run", async () => {
  find.mockResolvedValue(null);
  expect(await reader.read("other", "run")).toEqual({ status: "gone" });
});

it("requires current team and resource access before granting run metadata", async () => {
  const result = await reader.read("member", "run");
  expect(result).toMatchObject({
    status: "granted",
    relation: "team",
    plan: { id: "plan", name: "Plan" },
  });
  if (result.status !== "granted") throw new Error("Expected access");
  expect(result.flow.numberOf("agent")).toBe(2);
  expect(result.flow.isEntry("agent")).toBe(true);
  expect(result.flow.isStep("agent")).toBe(true);
  expect(result.flow.isStep("start")).toBe(false);
  expect(requireReadable).toHaveBeenCalledWith("member", "ticket");
});

it("does not expose a run to another team or a reader who lost access", async () => {
  team.mockResolvedValueOnce({ departmentIds: [] });
  expect(await reader.read("other", "run")).toEqual({ status: "denied" });
  requireReadable.mockRejectedValueOnce(new AgentError("plan_access_denied"));
  expect(await reader.read("member", "run")).toEqual({ status: "denied" });
});

it("propagates storage errors instead of treating them as authorization denial", async () => {
  resources.mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(reader.read("member", "run")).rejects.toThrow(
    "storage unavailable",
  );
});
