import { describe, expect, it } from "vitest";

import {
  PLAN_TEMPLATE_NAME_LENGTH,
  instantiatePlanTemplate,
  isPlanTemplateNode,
  isPlanTemplateType,
  planTemplateNameKey,
  planTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";

import {
  agent,
  boundary,
  edge,
  groupOf,
  loopOf,
  script,
} from "./plan-fixtures";

import type {
  AgentPlanBinding,
  AgentPlanParameter,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

const LITERAL: AgentPlanBinding = {
  kind: "literal",
  value: { type: "text", text: "kept" },
};
const SOURCE: AgentPlanBinding = { kind: "source", nodeId: "param" };
const PARAMETER: AgentPlanParameter = {
  id: "param",
  type: "parameter",
  name: "topic",
  format: "string",
  value: { type: "text", text: "Pages" },
  x: 40,
  y: 50,
};

function counter(): () => string {
  let next = 0;
  return () => `new-${(next += 1)}`;
}

describe("template kinds", () => {
  it("accepts parameter, agent, script and group as template types", () => {
    for (const type of ["parameter", "agent", "script", "group"])
      expect(isPlanTemplateType(type)).toBe(true);
    for (const type of ["loop", "start", "end", "task", ""])
      expect(isPlanTemplateType(type)).toBe(false);
    expect(PLAN_TEMPLATE_NAME_LENGTH).toBe(120);
  });

  it("accepts the same node kinds and refuses frames and boundaries", () => {
    for (const node of [PARAMETER, agent("a"), script("s"), groupOf("g", [])])
      expect(isPlanTemplateNode(node)).toBe(true);
    for (const node of [
      loopOf("l", []),
      boundary("start", "start"),
      boundary("end", "end"),
    ])
      expect(isPlanTemplateNode(node)).toBe(false);
  });

  it("keys a template name without case, surrounding blanks and composed forms", () => {
    expect(planTemplateNameKey("  Daily Report ")).toBe("daily report");
    expect(planTemplateNameKey("Café")).toBe(planTemplateNameKey("Café"));
  });
});

describe("saving a node as a template", () => {
  it("resets the position of a parameter", () => {
    expect(planTemplateNode(PARAMETER)).toEqual({ ...PARAMETER, x: 0, y: 0 });
  });

  it("resets the position of an agent or script and keeps only its literal bindings", () => {
    const bound = {
      ...agent("a", {
        fixed: LITERAL,
        shared: SOURCE,
        upstream: { kind: "result", stepId: "x" },
      }),
      x: 9,
      y: 8,
    };
    const scripted = script("s", {
      fixed: LITERAL,
      other: { kind: "previous", stepId: "x" },
    });

    expect(planTemplateNode(bound)).toMatchObject({
      x: 0,
      y: 0,
      bindings: { fixed: LITERAL },
    });
    expect(planTemplateNode(scripted)).toMatchObject({
      bindings: { fixed: LITERAL },
    });
  });

  it("keeps results between members of a group and drops every link to the outside", () => {
    const group: AgentPlanGroup = {
      ...groupOf("g", [
        agent("a", { fixed: LITERAL }),
        agent("b", {
          from_a: { kind: "result", stepId: "a" },
          outside: { kind: "result", stepId: "z" },
          shared: SOURCE,
        }),
      ]),
      x: 5,
      y: 6,
      parameters: [
        {
          id: "port",
          name: "n",
          type: "text",
          description: "",
          isRequired: false,
          defaultValue: null,
        },
      ],
      bindings: { n: LITERAL },
      edges: [edge("a", "b"), edge("b", "outside")],
    };

    const template = planTemplateNode(group);

    expect(template).toMatchObject({
      x: 0,
      y: 0,
      parameters: [],
      bindings: {},
      edges: [edge("a", "b")],
    });
    if (template.type !== "group") throw new Error("Expected a group.");
    expect(template.steps.map((step) => Object.keys(step.bindings))).toEqual([
      ["fixed"],
      ["from_a"],
    ]);
  });

  it("turns the implicit chain of a legacy group into explicit edges", () => {
    const template = planTemplateNode(groupOf("g", [agent("a"), agent("b")]));

    expect(template).toMatchObject({
      edges: [{ from: "a", to: "b", fromPort: "flow-out", toPort: "flow-in" }],
    });
  });
});

describe("placing a template into a plan", () => {
  it("copies a single node under a new id without touching the template", () => {
    const template = agent("a", { fixed: LITERAL });

    const placed = instantiatePlanTemplate(template, counter());

    expect(placed).toEqual({ ...template, id: "new-1" });
    expect(placed).not.toBe(template);
    expect(instantiatePlanTemplate(PARAMETER, counter())).toEqual({
      ...PARAMETER,
      id: "new-1",
    });
  });

  it("gives a group and every member new ids and rewires results and edges", () => {
    const template = planTemplateNode(
      groupOf("g", [
        agent("a"),
        agent("b", { from_a: { kind: "result", stepId: "a" }, fixed: LITERAL }),
      ]),
    );

    const placed = instantiatePlanTemplate(template, counter());

    if (placed.type !== "group") throw new Error("Expected a group.");
    expect(placed.id).toBe("new-3");
    expect(placed.steps.map((step) => step.id)).toEqual(["new-1", "new-2"]);
    expect(placed.steps[1]?.bindings).toEqual({
      from_a: { kind: "result", stepId: "new-1" },
      fixed: LITERAL,
    });
    expect(placed.edges).toEqual([
      { from: "new-1", to: "new-2", fromPort: "flow-out", toPort: "flow-in" },
    ]);
  });

  it("keeps an id the group does not know when it rewires", () => {
    const group = {
      ...groupOf("g", [agent("a")]),
      edges: [edge("a", "ghost")],
    };

    const placed = instantiatePlanTemplate(group, counter());

    if (placed.type !== "group") throw new Error("Expected a group.");
    expect(placed.edges).toEqual([{ ...edge("new-1", "ghost") }]);
  });
});
