import { expect, it } from "vitest";

import { McpPlanNotationRequest } from "@/backend/service/mcp/plan/McpPlanNotationRequest";

it("reads strict check and create requests", () => {
  expect(
    McpPlanNotationRequest.check({ notation: "plan", planId: "id" }),
  ).toEqual({ notation: "plan", planId: "id" });
  expect(
    McpPlanNotationRequest.create({ notation: "plan", operationId: "op" }),
  ).toBe("plan");
  expect(() =>
    McpPlanNotationRequest.check({ notation: "plan", extra: true }),
  ).toThrow();
  expect(() => McpPlanNotationRequest.create({ notation: 1 })).toThrow();
});

it("requires a positive exact revision and a supported layout direction", () => {
  expect(
    McpPlanNotationRequest.replace({ notation: "plan", expectedRevision: 2 }),
  ).toEqual({ notation: "plan", expectedRevision: 2 });
  expect(
    McpPlanNotationRequest.layout({ expectedRevision: 1, rankdir: "LR" }),
  ).toEqual({ expectedRevision: 1, rankdir: "LR" });
  expect(() =>
    McpPlanNotationRequest.replace({ notation: "plan", expectedRevision: 0 }),
  ).toThrow();
  expect(() =>
    McpPlanNotationRequest.layout({ expectedRevision: 1, rankdir: "diagonal" }),
  ).toThrow();
});

it("rejects missing or control-character path identifiers", () => {
  expect(McpPlanNotationRequest.planId("plan")).toBe("plan");
  expect(() => McpPlanNotationRequest.planId(undefined)).toThrow();
  expect(() => McpPlanNotationRequest.planId("bad\nvalue")).toThrow();
});
