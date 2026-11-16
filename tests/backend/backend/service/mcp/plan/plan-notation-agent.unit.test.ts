import { expect, it } from "vitest";

import {
  planNotationList,
  readPlanNotationAgent,
} from "@/backend/service/mcp/plan/PlanNotationAgent";
import { PlanNotationAttributes } from "@/backend/service/mcp/plan/PlanNotationAttributes";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { PlanNotationAttribute } from "@/backend/service/mcp/plan/PlanNotationParser";
import type { PlanNotationContext } from "@/backend/service/mcp/plan/PlanNotationContext";

function attribute(key: string, text: string): PlanNotationAttribute {
  return {
    key,
    line: 1,
    column: 1,
    value: { kind: "string", text, line: 1, column: 1 },
  };
}

it("reads explicit agent identifiers and completion checks", () => {
  const findings = { issues: [] };
  const attributes = new PlanNotationAttributes(
    [
      attribute("agentId", "agent"),
      attribute("personalAgent", "auto"),
      attribute("instruction", "Work"),
      attribute("checks", " lint, test ,, "),
      attribute("completion", "todos"),
    ],
    { nodeId: "node", location: { line: 1, column: 1 } },
    findings,
  );
  const context = partial<PlanNotationContext>({
    previous: null,
    sources: { agents: [] },
  });
  expect(readPlanNotationAgent(attributes, context, "node")).toMatchObject({
    agentId: "agent",
    personalAgentId: null,
    instruction: "Work",
    completion: "todos",
    completionGate: { version: 1, requiredChecks: ["lint", "test"] },
  });
  expect(findings.issues).toEqual([]);
  expect(planNotationList(" a, ,b ")).toEqual(["a", "b"]);
});

it("reports a missing agent selection", () => {
  const findings = { issues: [] };
  const attributes = new PlanNotationAttributes(
    [],
    { nodeId: "node", location: { line: 1, column: 1 } },
    findings,
  );
  const context = partial<PlanNotationContext>({
    previous: null,
    sources: { agents: [] },
  });
  expect(readPlanNotationAgent(attributes, context, "node")).toMatchObject({
    agentId: "",
  });
  expect(findings.issues).toMatchObject([{ code: "invalid_value" }]);
});
