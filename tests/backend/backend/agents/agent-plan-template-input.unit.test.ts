import { expect, it } from "vitest";

import {
  readPlanTemplate,
  readPlanTemplateName,
  readPlanTemplateNode,
} from "@/backend/agents/AgentPlanTemplateInput";

import { agentErrorCode } from "./agent-error-code";
import { POSITION, agentNode } from "./agent-plan-input-fixture";

const TEMPLATE = {
  id: "template",
  name: "Reviewer",
  type: "agent",
  isShared: false,
  createdAt: "now",
  node: agentNode(),
};

it("reads a trimmed template name", () => {
  expect(readPlanTemplateName(" Reviewer ")).toBe("Reviewer");
});

it.each<[unknown, string]>([
  [null, "template_name_required"],
  ["  ", "template_name_required"],
  ["x".repeat(121), "template_invalid"],
  ["a\u0007b", "template_invalid"],
])("refuses the template name %j as %s", (input, code) => {
  expect(agentErrorCode(() => readPlanTemplateName(input))).toBe(code);
});

it("reads the submitted node of a template", () => {
  expect(readPlanTemplateNode(JSON.stringify(agentNode()))).toMatchObject({
    id: "a1",
    type: "agent",
  });
});

it.each<[string, unknown, string]>([
  ["no text", { id: "a1" }, "template_invalid"],
  ["an oversized node", "x".repeat(2_000_001), "template_invalid"],
  [
    "a node type without templates",
    JSON.stringify({ id: "s", ...POSITION, type: "start" }),
    "template_invalid",
  ],
  ["a malformed node", JSON.stringify({ id: "a1" }), "plan_invalid"],
  ["text that is no JSON", "{", "other"],
])("refuses a template node with %s", (scenario, input, code) => {
  expect(agentErrorCode(() => readPlanTemplateNode(input))).toBe(code);
});

it("reads a stored template", () => {
  expect(readPlanTemplate(TEMPLATE)).toMatchObject({
    id: "template",
    name: "Reviewer",
    type: "agent",
    isShared: false,
    createdAt: "now",
    node: { id: "a1", type: "agent" },
  });
});

it.each<[string, Record<string, unknown>]>([
  ["an id that is no text", { id: 1 }],
  ["a name that is no text", { name: null }],
  ["a type that is no text", { type: 2 }],
  ["a shared flag that is no boolean", { isShared: "no" }],
  ["a creation time that is no text", { createdAt: 0 }],
  ["an unknown type", { type: "loop" }],
  ["a node of another type", { type: "script" }],
])("refuses a stored template with %s", (scenario, change) => {
  expect(
    agentErrorCode(() => readPlanTemplate({ ...TEMPLATE, ...change })),
  ).toBe("template_invalid");
});
