import { describe, expect, it } from "vitest";

import { planBindings } from "@/backend/service/agents/AgentPlanBindings";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import {
  fitsPlanParameter,
  isPlanFlowNode,
  planConnectionIssues,
  planExecutionIssues,
  withoutTicketFlow,
} from "@/definition/AgentPlanGraph";

import { parameterRunFixture } from "./page55-run-fixture";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";

const TEMPLATE: AgentConfiguration = {
  ...emptyAgentConfiguration(),
  markdown: "Review this ticket:\n{{ticket}}\nNotes: {{notes}}",
  parameters: [
    {
      name: "ticket",
      type: "ticket",
      description: "",
      isRequired: true,
      defaultValue: null,
    },
    {
      name: "notes",
      type: "text",
      description: "",
      isRequired: false,
      defaultValue: null,
    },
    {
      name: "count",
      type: "number",
      description: "",
      isRequired: false,
      defaultValue: null,
    },
  ],
};

const AGENT: AgentDefinitionChoice = {
  id: "agent",
  name: "Reviewer",
  model: "synthetic-free:free",
  reasoningEffort: null,
  provider: "openrouter",
  purposes: ["agent"],
  revision: 1,
  configuration: TEMPLATE,
  availability: { isUsable: true, reason: null, personalChoices: [] },
};

const STEP: AgentPlanStep = {
  id: "step",
  type: "agent",
  x: 400,
  y: 40,
  agentId: "agent",
  personalAgentId: null,
  instruction: "",
  bindings: { ticket: { kind: "source", nodeId: "ticket-node" } },
};

/** Start → agent → end, plus a ticket node that only feeds the agent's ticket parameter. */
function ticketPlan(step: AgentPlanStep = STEP): AgentPlan {
  return {
    id: "plan",
    ownerId: "owner",
    name: "Synthetic plan",
    workspaceId: "workspace",
    projectId: "project",
    usage: "private",
    globals: {},
    revision: 1,
    nodes: [
      { id: "start", type: "start", x: 0, y: 40 },
      step,
      { id: "ticket-node", type: "task", x: 0, y: 400, taskId: "ticket-id" },
      { id: "end", type: "end", x: 800, y: 40 },
    ],
    edges: [
      { from: "start", to: "step", fromPort: "flow-out", toPort: "flow-in" },
      { from: "step", to: "end", fromPort: "flow-out", toPort: "flow-in" },
    ],
  };
}

describe("ticket node in the plan graph", () => {
  it("is a value source without flow ports that needs no preceding start", () => {
    const plan = ticketPlan();
    const ticket = plan.nodes.find((node) => node.type === "task");
    expect(ticket && isPlanFlowNode(ticket)).toBe(false);
    expect(planExecutionIssues(plan, [AGENT])).toEqual([]);
  });

  it("rejects a flow edge into or out of the ticket node", () => {
    const plan = ticketPlan();
    const issues = planConnectionIssues(
      {
        ...plan,
        edges: [
          ...plan.edges,
          {
            from: "start",
            to: "ticket-node",
            fromPort: "flow-out",
            toPort: "flow-in",
          },
          {
            from: "ticket-node",
            to: "step",
            fromPort: "flow-out",
            toPort: "flow-in",
          },
        ],
      },
      [AGENT],
    );
    expect(issues).toContainEqual({
      nodeId: "ticket-node",
      port: "flow-in",
      reason: "port",
    });
    expect(issues).toContainEqual({
      nodeId: "ticket-node",
      port: "flow-out",
      reason: "port",
    });
  });

  it("fits a ticket parameter, keeps fitting text parameters of earlier plans and rejects other types", () => {
    const ticket = ticketPlan().nodes.find((node) => node.type === "task");
    expect(fitsPlanParameter(ticket, "ticket")).toBe(true);
    expect(fitsPlanParameter(ticket, "text")).toBe(true);
    expect(fitsPlanParameter(ticket, "number")).toBe(false);
    const issues = planConnectionIssues(
      ticketPlan({
        ...STEP,
        bindings: { count: { kind: "source", nodeId: "ticket-node" } },
      }),
      [AGENT],
    );
    expect(issues).toContainEqual({
      nodeId: "step",
      port: "count",
      reason: "type",
    });
  });

  it("replaces flow edges through ticket nodes of earlier plans by direct edges", () => {
    const plan = ticketPlan();
    const legacy: AgentPlan = {
      ...plan,
      nodes: [
        ...plan.nodes,
        { id: "second", type: "task", x: 0, y: 600, taskId: "other-id" },
      ],
      edges: [
        {
          from: "start",
          to: "ticket-node",
          fromPort: "flow-out",
          toPort: "flow-in",
        },
        {
          from: "ticket-node",
          to: "second",
          fromPort: "flow-out",
          toPort: "flow-in",
        },
        { from: "second", to: "step", fromPort: "flow-out", toPort: "flow-in" },
        { from: "step", to: "end", fromPort: "flow-out", toPort: "flow-in" },
      ],
    };
    const current = withoutTicketFlow(legacy);
    expect(current.edges).toEqual([
      { from: "step", to: "end", fromPort: "flow-out", toPort: "flow-in" },
      { from: "start", to: "step", fromPort: "flow-out", toPort: "flow-in" },
    ]);
    expect(current.nodes).toEqual(legacy.nodes);
    expect(planExecutionIssues(current, [AGENT])).toEqual([]);
    expect(withoutTicketFlow(plan)).toBe(plan);
  });
});

describe("ticket node at execution", () => {
  it("passes the referenced ticket as the value of the agent's ticket parameter", async () => {
    const plan = ticketPlan({
      ...STEP,
      bindings: {
        ticket: { kind: "source", nodeId: "ticket-node" },
        notes: { kind: "source", nodeId: "ticket-node" },
      },
    });
    const step = plan.nodes.find((node) => node.type === "agent");
    if (!step) throw new Error("Missing synthetic agent node");
    const bindings = planBindings(
      plan,
      step,
      [{ id: "ticket-id", markdown: "# SYN-61 snapshot", version: "1" }],
      TEMPLATE.parameters,
    );
    expect(bindings).toEqual({
      ticket: { type: "ticket", ticketId: "ticket-id" },
      notes: { type: "text", text: "# SYN-61 snapshot" },
    });
    const fixture = await parameterRunFixture();
    const prepared = await fixture.parameters.prepare(
      "owner",
      { agentId: "agent", personalAgentId: null, workspaceId: "workspace" },
      bindings,
      TEMPLATE,
    );
    expect(prepared.parameters.values.ticket).toEqual({
      type: "ticket",
      ticketId: "ticket-id",
    });
    expect(prepared.parameters.markdown).toContain(
      "Review this ticket:\n# SYN-55\n\nFull description",
    );
    expect(prepared.tickets?.["ticket-id"]?.markdown).toContain("# SYN-55");
  });
});
