import { expect, it } from "vitest";

import {
  readPlanContinuation,
  readPlanPauseBoundary,
} from "@/backend/agents/AgentPlanContinuationInput";

import { agentErrorCode } from "./agent-error-code";

const BOUNDARY = {
  pausedAt: "2026-10-20 10:00:00",
  completedStepIds: ["a"],
  pendingStepIds: [],
  frontierStepIds: ["b"],
};

it("reads no pause boundary and no continuation from old records", () => {
  expect(readPlanPauseBoundary(undefined)).toEqual({});
  expect(readPlanContinuation(undefined)).toEqual({});
});

it("reads a pause boundary", () => {
  expect(readPlanPauseBoundary(BOUNDARY)).toEqual({ pauseBoundary: BOUNDARY });
});

it.each([
  ["identifiers that are no list", { completedStepIds: "a" }],
  [
    "more than 100 identifiers",
    { pendingStepIds: Array.from({ length: 101 }, () => "a") },
  ],
  ["an empty identifier", { frontierStepIds: [" "] }],
])("refuses a pause boundary with %s", (scenario, change) => {
  expect(
    agentErrorCode(() => readPlanPauseBoundary({ ...BOUNDARY, ...change })),
  ).toBe("plan_invalid");
});

it("reads a continuation marker", () => {
  expect(
    readPlanContinuation({ version: 1, planRevision: 3, adoptedAt: "now" }),
  ).toEqual({
    continuation: { version: 1, planRevision: 3, adoptedAt: "now" },
  });
});

it.each([
  { version: "1", planRevision: 1 },
  { version: 1.5, planRevision: 1 },
  { version: 0, planRevision: 1 },
  { version: 1, planRevision: null },
  { version: 1, planRevision: 2.5 },
  { version: 1, planRevision: 0 },
])("refuses the continuation marker %j", (marker) => {
  expect(
    agentErrorCode(() => readPlanContinuation({ ...marker, adoptedAt: "now" })),
  ).toBe("plan_invalid");
});
