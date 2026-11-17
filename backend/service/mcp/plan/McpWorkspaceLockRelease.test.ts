import { expect, it, vi } from "vitest";

import { ownerOperations, sessionOperations } from "../AgentOperationCatalog";
import { McpPlanApi } from "./McpPlanApi";
import { AgentPlanOperationService } from "@/backend/service/agents/AgentPlanOperationService";

import type { AgentIdentity } from "@/definition/McpAuthorization";

const identity: AgentIdentity = {
  userId: "owner",
  isAdmin: false,
  permissions: [],
};

function fixture(): {
  api: McpPlanApi;
  handle: ReturnType<
    typeof vi.fn<
      ConstructorParameters<typeof McpPlanApi>[0]["operations"]["handle"]
    >
  >;
} {
  const handle = vi.fn<
    ConstructorParameters<typeof McpPlanApi>[0]["operations"]["handle"]
  >(async () => ({
    apiVersion: "1",
    result: { planId: "plan", revision: 4, releasedRunId: "older-run" },
  }));
  const api = new McpPlanApi(
    { operations: { handle }, identities: { verify: async () => identity } },
    {
      devices: {
        authenticate: async () => {
          throw new Error("No real credentials in this test");
        },
      },
      accounts: { findCredentialsByUsername: async () => null },
    },
  );
  return { api, handle };
}

it("forwards the paired account and exact release decision, preserving response fields", async () => {
  const { api, handle } = fixture();
  const result = await api.run(identity, "plans.workspace_locks.release", {
    path: { planId: "plan", runId: "older-run" },
    parameters: { operationId: "stable-decision" },
  });
  expect(handle).toHaveBeenCalledWith(
    identity,
    "plans.workspace_locks.release",
    {
      planId: "plan",
      runId: "older-run",
      operationId: "stable-decision",
    },
  );
  expect(result).toEqual({
    planId: "plan",
    revision: 4,
    releasedRunId: "older-run",
  });
});

it("refuses a body that replaces the path's run target before dispatch", async () => {
  const { api, handle } = fixture();
  await expect(
    api.run(identity, "plans.workspace_locks.release", {
      path: { planId: "plan", runId: "older-run" },
      parameters: { operationId: "stable-decision", runId: "other-run" },
    }),
  ).rejects.toThrow();
  expect(handle).not.toHaveBeenCalled();
});

it("offers the command to personal accounts while retaining server authorization", () => {
  expect(ownerOperations(false)).toContain("plans.workspace_locks.release");
});

it.each(["tickets", "read", "full"] as const)(
  "never delegates release to a %s run credential",
  (reach) => {
    for (const isManagement of [false, true])
      expect(
        sessionOperations(
          {
            runId: "run",
            stepId: "step",
            reach,
            tickets: [],
            operations: ["plans.workspace_locks.release"],
          },
          true,
          isManagement,
        ),
      ).not.toContain("plans.workspace_locks.release");
  },
);

it("rejects a direct run-scoped call even if a client ignores the hidden catalog", async () => {
  async function unavailable(): Promise<never> {
    throw new Error("No persistence or plan access may occur");
  }
  const service = new AgentPlanOperationService({
    database: { transaction: unavailable },
    plans: {
      visible: unavailable,
      view: unavailable,
      directory: unavailable,
      sources: unavailable,
      workspaces: unavailable,
      readableRun: unavailable,
      agents: unavailable,
      save: unavailable,
      teamRuns: {
        entries: unavailable,
        overview: unavailable,
        starters: unavailable,
      },
    },
  });
  await expect(
    service.handle(
      {
        ...identity,
        run: {
          runId: "run",
          stepId: "step",
          reach: "full",
          operations: [],
          tickets: [],
        },
      },
      "plans.workspace_locks.release",
      { operationId: "decision", planId: "plan", runId: "older-run" },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
