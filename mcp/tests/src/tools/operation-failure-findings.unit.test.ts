import { describe, expect, it } from "vitest";

import { operationFailure } from "../../../src/tools/operation-failure.ts";

const ISSUE = { nodeId: "node-1", port: "flow-in", problem: "flowIn" };
const MAXIMUM_ISSUES = Array.from({ length: 50 }, (_, index) => ({
  ...ISSUE,
  nodeId: `node-${index}`,
}));
const ISSUE_BOUNDARIES = [[], MAXIMUM_ISSUES];
const INVALID_FINDINGS = [
  {
    label: "an inherited method name",
    issue: { ...ISSUE, problem: "toString" },
  },
  { label: "a prototype key", issue: { ...ISSUE, problem: "__proto__" } },
  { label: "a constructor name", issue: { ...ISSUE, problem: "constructor" } },
  { label: "a numeric problem", issue: { ...ISSUE, problem: 1 } },
  { label: "a missing problem", issue: { nodeId: "node-1", port: null } },
  { label: "a missing node", issue: { port: null, problem: "start" } },
  { label: "a missing port", issue: { nodeId: null, problem: "end" } },
];

function graphRejection(issues: unknown): Response {
  return Response.json(
    {
      apiVersion: "1",
      error: {
        code: "INVALID_REQUEST",
        details: { reason: "graph_invalid", issues, privateField: "discard" },
      },
    },
    { status: 400 },
  );
}

describe("operationFailure graph findings", () => {
  it.each(ISSUE_BOUNDARIES.map((issues) => ({ count: issues.length, issues })))(
    "accepts the finding count boundary $count",
    async ({ issues }) => {
      const failure = await operationFailure(graphRejection(issues));

      expect(failure?.code).toBe("INVALID_REQUEST");
      expect(failure?.details).toEqual({ reason: "graph_invalid", issues });
    },
  );

  it.each(INVALID_FINDINGS)(
    "drops the entire findings list when a valid entry is followed by $label",
    async ({ issue }) => {
      const failure = await operationFailure(graphRejection([ISSUE, issue]));

      expect(failure?.code).toBe("INVALID_REQUEST");
      expect(failure?.details).toEqual({ reason: "graph_invalid" });
    },
  );

  it("drops private fields from every finding", async () => {
    const failure = await operationFailure(
      graphRejection([{ ...ISSUE, privateField: "discard" }]),
    );

    expect(failure?.details).toEqual({
      reason: "graph_invalid",
      issues: [ISSUE],
    });
  });
});
