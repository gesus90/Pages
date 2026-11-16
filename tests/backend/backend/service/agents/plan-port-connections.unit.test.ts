import { expect, it } from "vitest";

import { applyPlanPortConnection } from "@/backend/service/agents/AgentPlanPortConnections";

import {
  AGENTS,
  decision,
  member,
} from "../../../definition/group-edit-fixtures";
import { planOf } from "../../../definition/plan-fixtures";

import type { AgentPlanPortConnection } from "@/backend/service/agents/AgentPlanPortConnections";

const FLOW: AgentPlanPortConnection = {
  action: "connect",
  from: "a",
  to: "b",
  ports: { fromPort: "flow-out", toPort: "flow-in" },
};

it("connects and disconnects a flow edge and rejects duplicate or missing edges", () => {
  const plan = planOf([member("a"), member("b")]);
  const connected = applyPlanPortConnection(plan, FLOW, AGENTS);
  expect(connected.edges).toContainEqual({ from: "a", to: "b", ...FLOW.ports });
  expect(() => applyPlanPortConnection(connected, FLOW, AGENTS)).toThrow();
  const disconnected = applyPlanPortConnection(
    connected,
    { ...FLOW, action: "disconnect" },
    AGENTS,
  );
  expect(disconnected.edges).not.toContainEqual({
    from: "a",
    to: "b",
    ...FLOW.ports,
  });
  expect(() =>
    applyPlanPortConnection(
      disconnected,
      { ...FLOW, action: "disconnect" },
      AGENTS,
    ),
  ).toThrow();
});

it("rejects incompatible ports and connections to nonexistent decisions", () => {
  const plan = planOf([member("a"), member("b"), decision("d")]);
  expect(() =>
    applyPlanPortConnection(
      plan,
      { ...FLOW, ports: { fromPort: "value-out", toPort: "event-in" } },
      AGENTS,
    ),
  ).toThrow();
  expect(() =>
    applyPlanPortConnection(
      plan,
      { ...FLOW, ports: { fromPort: "value-out", toPort: "condition-in" } },
      AGENTS,
    ),
  ).toThrow();
  expect(() =>
    applyPlanPortConnection(
      plan,
      { ...FLOW, ports: { fromPort: "passed-out", toPort: "flow-in" } },
      AGENTS,
    ),
  ).toThrow();
});
