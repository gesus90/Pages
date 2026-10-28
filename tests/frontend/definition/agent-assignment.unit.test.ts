import { expect, it } from "vitest";

import { AGENT_FUNCTIONS, isAgentFunction } from "@/definition/AgentAssignment";

it("accepts only the defined agent functions", () => {
  expect(AGENT_FUNCTIONS).toEqual(["skills"]);
  expect(isAgentFunction("skills")).toBe(true);
  expect(isAgentFunction("chat")).toBe(false);
  expect(isAgentFunction(undefined)).toBe(false);
});
