import { expect, it } from "vitest";

import { defaultPlanId, DEFAULT_PLAN_NAME } from "@/app/lib/agent-plan-default";

import type { AgentPlanView } from "@/definition/AgentPlan";

/** A readable plan; only identity, name and owner matter for the default. */
function plan(id: string, name: string, ownerId: string): AgentPlanView {
  return {
    id,
    name,
    ownerId,
    projectId: "project",
    workspaceId: "workspace",
    usage: "private",
    globals: {},
    nodes: [],
    edges: [],
    revision: 1,
    canEdit: true,
    projectName: "Project",
    github: null,
  };
}

it("prefers the person's own plan with the default name over a shared one", () => {
  const plans = [
    plan("shared", DEFAULT_PLAN_NAME, "someone-else"),
    plan("own", ` ${DEFAULT_PLAN_NAME} `, "person"),
  ];

  expect(defaultPlanId(plans, "person")).toBe("own");
});

it("falls back to the first readable plan with the default name", () => {
  const plans = [
    plan("other", "Other", "person"),
    plan("first", DEFAULT_PLAN_NAME, "a"),
    plan("second", DEFAULT_PLAN_NAME, "b"),
  ];

  expect(defaultPlanId(plans, "person")).toBe("first");
});

it("finds no default plan when no readable plan carries the name", () => {
  expect(
    defaultPlanId([plan("other", "Other", "person")], "person"),
  ).toBeNull();
  expect(defaultPlanId([], "person")).toBeNull();
});
