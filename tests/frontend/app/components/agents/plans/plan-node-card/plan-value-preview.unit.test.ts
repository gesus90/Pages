import { expect, it } from "vitest";

import {
  isEmptyPlanValue,
  planBindingPreview,
  planValuePreview,
} from "@/app/components/agents/plans/plan-node-card/plan-value-preview";

import { SOURCES } from "../../page61-plan-fixture";
import {
  agentStep,
  groupNode,
  i18n,
  loopNode,
  planOf,
  scriptStep,
} from "../plan-flow-fixture";

import type { PlanValueContext } from "@/app/components/agents/plans/plan-node-card/plan-value-preview";
import type { AgentPlanInput } from "@/definition/AgentPlan";

function context(draft: AgentPlanInput = planOf([])): PlanValueContext {
  return {
    draft,
    sources: SOURCES,
    workspaces: [
      {
        id: "workspace",
        name: "Main workspace",
        path: "/synthetic",
        projectId: "project",
        projectName: "Project",
        github: null,
        isUsable: true,
        reason: null,
      },
    ],
    translate: i18n.t,
  };
}

it("treats only absent content as empty, so spaces are kept", () => {
  expect(isEmptyPlanValue({ type: "text", text: "" })).toBe(true);
  expect(isEmptyPlanValue({ type: "text", text: " " })).toBe(false);
  expect(isEmptyPlanValue({ type: "number", number: Number.NaN })).toBe(true);
  expect(isEmptyPlanValue({ type: "number", number: 0 })).toBe(false);
  expect(isEmptyPlanValue({ type: "ticket", ticketId: "" })).toBe(true);
  expect(isEmptyPlanValue({ type: "ticket", ticketId: "1" })).toBe(false);
  expect(isEmptyPlanValue({ type: "workspace", workspaceId: "" })).toBe(true);
  expect(isEmptyPlanValue({ type: "workspace", workspaceId: "w" })).toBe(false);
  expect(isEmptyPlanValue({ type: "wiki", pageId: "" })).toBe(true);
  expect(isEmptyPlanValue({ type: "wiki", pageId: "page" })).toBe(false);
});

it("names text, numbers, wiki pages, tickets and workspaces, and an unavailable reference without its content", () => {
  const values = context();
  expect(planValuePreview(null, values)).toBe("");
  expect(planValuePreview({ type: "text", text: "" }, values)).toBe("");
  expect(planValuePreview({ type: "text", text: "hello" }, values)).toBe(
    "hello",
  );
  expect(planValuePreview({ type: "number", number: 2.5 }, values)).toBe("2.5");
  expect(planValuePreview({ type: "wiki", pageId: "page-7" }, values)).toBe(
    "page-7",
  );
  expect(planValuePreview({ type: "ticket", ticketId: "1" }, values)).toBe(
    "SYN-1: Open work",
  );
  expect(planValuePreview({ type: "ticket", ticketId: "gone" }, values)).toBe(
    i18n.t("plans.ticketUnavailable"),
  );
  expect(
    planValuePreview({ type: "workspace", workspaceId: "workspace" }, values),
  ).toBe("Main workspace");
  expect(
    planValuePreview({ type: "workspace", workspaceId: "gone" }, values),
  ).toBe(i18n.t("plans.workspaceUnavailable"));
});

it("names the result of an agent, a group member, a loop member and a script", () => {
  const draft = planOf([
    { ...agentStep("reviewer"), agentId: "reviewer" },
    groupNode("group", [{ ...agentStep("grouped"), agentId: "writer" }]),
    loopNode("loop", [scriptStep("looped", 1)]),
    scriptStep("script", 1),
  ]);
  const values = context(draft);
  const result = (stepId: string): string =>
    planBindingPreview({ kind: "result", stepId }, values);
  expect(result("reviewer")).toBe(
    i18n.t("plans.resultOf", { name: "Reviewer" }),
  );
  expect(result("grouped")).toBe(i18n.t("plans.resultOf", { name: "Writer" }));
  expect(result("looped")).toBe(
    i18n.t("plans.resultOf", { name: "Script looped" }),
  );
  expect(result("script")).toBe(
    i18n.t("plans.resultOf", { name: "Script script" }),
  );
  expect(result("gone")).toBe(i18n.t("plans.resultOf", { name: "gone" }));
  expect(
    planBindingPreview({ kind: "previous", stepId: "looped" }, values),
  ).toBe(i18n.t("plans.loops.previousOf", { name: "Script looped" }));
});

it("names the value of a literal, a parameter, a ticket, another node, a group port or a missing source", () => {
  const draft = planOf([
    {
      id: "value",
      type: "parameter",
      x: 0,
      y: 0,
      name: "value",
      format: "string",
      value: { type: "text", text: "typed" },
    },
    { id: "ticket", type: "task", x: 0, y: 0, taskId: "2" },
    { id: "variable", type: "variable", x: 0, y: 0, name: "region" },
    groupNode("group", [], {
      parameters: [
        {
          id: "port",
          name: "input",
          type: "text",
          description: "",
          isRequired: false,
          defaultValue: null,
        },
      ],
    }),
  ]);
  const values = context(draft);
  const source = (nodeId: string): string =>
    planBindingPreview({ kind: "source", nodeId }, values);
  expect(
    planBindingPreview(
      { kind: "literal", value: { type: "text", text: "own" } },
      values,
    ),
  ).toBe("own");
  expect(source("value")).toBe("typed");
  expect(source("ticket")).toBe("SYN-2: Ongoing");
  expect(source("variable")).toBe("region");
  expect(source("port")).toBe(
    i18n.t("plans.groupPortValue", { name: "input" }),
  );
  expect(source("gone")).toBe(i18n.t("plans.validation.source"));
});
