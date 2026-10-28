import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanControlService } from "@/backend/service/agents/AgentPlanControlService";
import { AgentPlanStartRejectionRepository } from "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository";
import { readPlanControlHistoryRequest } from "@/backend/service/agents/AgentPlanResourceReads";

import { PlanWorld, runnablePlan } from "./plan-operation-world";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";

const REJECTION: AgentPlanStartRejection = {
  id: "older",
  createdAt: "2026-10-28T12:00:00.000Z",
  action: "play",
  planRevision: 1,
  isSavedRevision: true,
  error: "plan_workspace_conflict",
  conflict: {
    kind: "reserved",
    nodes: [{ id: "writer", name: "Writer" }],
    targets: [
      {
        kind: "local",
        workspaceId: "workspace-1",
        path: "/synthetic",
        connectionName: null,
        workspaceName: null,
      },
    ],
  },
  reservation: "held",
  targetResolution: "local_resolved",
};

it("keeps history optional and rejects an unrequested or malformed cursor", () => {
  expect(readPlanControlHistoryRequest({ planId: "plan" })).toEqual({
    planId: "plan",
    before: null,
  });
  expect(
    readPlanControlHistoryRequest({
      planId: "plan",
      includeStartRejections: true,
      beforeRejectionId: "entry",
    }),
  ).toEqual({ planId: "plan", before: "entry" });
  expect(() =>
    readPlanControlHistoryRequest({
      planId: "plan",
      beforeRejectionId: "entry",
    }),
  ).toThrow();
  expect(() =>
    readPlanControlHistoryRequest({
      planId: "plan",
      includeStartRejections: false,
    }),
  ).toThrow();
  expect(() =>
    readPlanControlHistoryRequest({
      planId: "plan",
      includeStartRejections: true,
      beforeRejectionId: 4,
    }),
  ).toThrow();
});

function historyFixture(): {
  readonly control: AgentPlanControlService;
  readonly page: ReturnType<
    typeof vi.fn<AgentPlanStartRejectionRepository["page"]>
  >;
  readonly requireAccess: ReturnType<
    typeof vi.fn<
      (userId: string, id: string, projectId: string) => Promise<void>
    >
  >;
  readonly world: PlanWorld;
} {
  const world = new PlanWorld();
  const plan = runnablePlan("plan");
  const page = vi.fn<AgentPlanStartRejectionRepository["page"]>(async () => ({
    entry: REJECTION,
    nextBefore: "older",
  }));
  const requireAccess = vi.fn<
    (userId: string, id: string, projectId: string) => Promise<void>
  >(async () => undefined);
  const control = new AgentPlanControlService({
    access: {
      require: async (userId) => {
        if (userId === "hidden") throw new AgentError("plan_access_denied");
        return {
          ...plan,
          canEdit: userId !== "reader",
          projectName: "Synthetic",
          github: null,
        };
      },
    },
    profiles: { catalog: async () => world.catalog },
    startRejections: { latest: async () => REJECTION, page },
    workspaceCatalog: { requireAccess },
    runs: {
      latest: async () => null,
      hasReservation: async () => false,
      findWorkspaceReservation: async () => null,
      resources: async () => ({
        projectId: plan.projectId,
        workspaceIds: [plan.workspaceId],
        taskIds: [],
        wikiIds: [],
        ticketIds: [],
        agentIds: [],
      }),
    },
  });
  return { control, page, requireAccess, world };
}

it("scopes a history page to the requesting editor and rechecks its historical target", async () => {
  const { control, page, requireAccess } = historyFixture();
  expect(await control.rejectionHistory("owner", "plan", "newest")).toEqual({
    entry: REJECTION,
    nextBefore: "older",
  });
  expect(page).toHaveBeenCalledWith("owner", "plan", "newest");
  expect(requireAccess).toHaveBeenCalledWith(
    "owner",
    "workspace-1",
    "project-1",
  );
});

it.each(["reader", "hidden"])(
  "does not read history for %s",
  async (userId) => {
    const { control, page } = historyFixture();
    await expect(
      control.rejectionHistory(userId, "plan", null),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    expect(page).not.toHaveBeenCalled();
  },
);

it("hides a revoked historical target and propagates infrastructure failures", async () => {
  const { control, requireAccess } = historyFixture();
  requireAccess.mockRejectedValueOnce(new AgentError("plan_access_denied"));
  const result = await control.rejectionHistory("owner", "plan", null);
  expect(result.entry).toMatchObject({
    conflict: null,
    targetResolution: "unknown",
  });
  expect(JSON.stringify(result)).not.toContain("/synthetic");
  const failure = new Error("Synthetic database unavailable");
  requireAccess.mockRejectedValueOnce(failure);
  await expect(control.rejectionHistory("owner", "plan", null)).rejects.toBe(
    failure,
  );
});

it("marks the end of a page and binds both the query and cursor lookup to the owner and plan", async () => {
  const query = vi
    .fn<Database["query"]>()
    .mockResolvedValueOnce([
      [JSON.stringify(REJECTION)],
      [JSON.stringify({ ...REJECTION, id: "oldest" })],
    ])
    .mockResolvedValueOnce([[JSON.stringify(REJECTION)]])
    .mockResolvedValueOnce([]);
  const repository = new AgentPlanStartRejectionRepository({
    query,
    transaction: async () => {
      throw new Error("A history read must not open a write transaction");
    },
  });
  expect(await repository.page("owner", "plan", "newest")).toEqual({
    entry: REJECTION,
    nextBefore: "older",
  });
  expect(await repository.page("owner", "plan", "older")).toEqual({
    entry: REJECTION,
    nextBefore: null,
  });
  expect(await repository.page("owner", "plan", "foreign")).toEqual({
    entry: null,
    nextBefore: null,
  });
  expect(query.mock.calls[0]?.[1]).toEqual({
    user_id: "owner",
    plan_id: "plan",
    before: "newest",
  });
  const sql = query.mock.calls[0]?.[0] ?? "";
  expect(sql.match(/user_id = \$user_id/gu)).toHaveLength(2);
  expect(sql.match(/plan_id = \$plan_id/gu)).toHaveLength(2);
  expect(sql).toContain("sequence_number <");
  expect(sql).toContain("ORDER BY sequence_number DESC");
});

it("refuses history through run-scoped credentials before accessing any resource", async () => {
  const { world } = historyFixture();
  await expect(
    world.operations.handle(
      {
        ...world.identity("owner"),
        run: {
          runId: "run",
          stepId: "step",
          operations: [],
          tickets: [],
          reach: "full",
        },
      },
      "plans.control.read",
      { planId: "plan", includeStartRejections: true },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
