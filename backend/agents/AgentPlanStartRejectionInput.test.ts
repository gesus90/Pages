import { describe, expect, it } from "vitest";

import {
  planStartRejectionIssuesSchema,
  readPlanStartRejection,
} from "@/backend/agents/AgentPlanStartRejectionInput";
import { AgentError } from "@/backend/error/AgentErrors";

function rejection(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "r1",
    createdAt: "2026-01-01T00:00:00.000Z",
    action: "play",
    planRevision: 1,
    isSavedRevision: true,
    error: "plan_invalid",
    conflict: null,
    reservation: "not_requested",
    targetResolution: "unknown",
    ...overrides,
  };
}

describe("readPlanStartRejection", () => {
  it("reads a refusal without optional parts", () => {
    expect(readPlanStartRejection(rejection())).toMatchObject({ id: "r1" });
  });

  it("reads a refusal with a conflict and issues", () => {
    const result = readPlanStartRejection(
      rejection({
        issueDetailsFiltered: true,
        issues: [{ nodeId: null, port: null, problem: "remoteModel" }],
        conflict: {
          kind: "reserved",
          targets: [
            {
              kind: "remote",
              workspaceId: "w",
              path: "/p",
              connectionName: null,
              workspaceName: "name",
            },
          ],
          nodes: [{ id: "n", name: "Node" }],
        },
      }),
    );

    expect(result.conflict?.nodes).toHaveLength(1);
  });

  it("rejects an unknown error code and malformed input", () => {
    expect(() =>
      readPlanStartRejection(rejection({ error: "not_a_code" })),
    ).toThrow(AgentError);
    expect(() => readPlanStartRejection("x")).toThrow(AgentError);
  });
});

describe("planStartRejectionIssuesSchema", () => {
  it("allows at most fifty findings", () => {
    const issue = { nodeId: "n", port: "p", problem: "remoteModel" };

    expect(
      planStartRejectionIssuesSchema.safeParse(Array(51).fill(issue)).success,
    ).toBe(false);
  });
});
