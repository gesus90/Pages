import { expect, it, vi } from "vitest";

import { AgentPlanWriteOperations } from "@/backend/service/agents/AgentPlanWriteOperations";
import { AgentPlanSettings } from "@/backend/service/agents/AgentPlanSettings";
import { AgentError } from "@/backend/error/AgentErrors";
import { readPlanResources } from "@/backend/service/agents/AgentPlanResourceReads";
import { fullPlanTeam } from "@/definition/AgentPlanTeam";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { planView, WORKSPACE } from "./agent-plan-service-harness";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentPlanAccessRequest } from "@/backend/service/agents/AgentPlanTeamService";

const { writeAccess } = vi.hoisted(() => ({
  writeAccess: vi.fn(async () => 6),
}));
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanAccessRepository",
  () => ({ writePlanAccess: writeAccess }),
);

function settingsWorld(): {
  readonly service: AgentPlanSettings;
  readonly save: ReturnType<typeof vi.fn>;
  readonly validateChange: ReturnType<typeof vi.fn>;
  readonly transaction: DatabaseTransaction;
} {
  const transaction: DatabaseTransaction = partial({});
  const previous = planView({ revision: 4 });
  const save = vi.fn(
    async (
      plan: AgentPlan,
      isNew: boolean,
      journal?: (transaction: DatabaseTransaction) => Promise<void>,
    ) => {
      void plan;
      void isNew;
      await journal?.(transaction);
    },
  );
  const validateChange = vi.fn(
    async (_: unknown, request: AgentPlanAccessRequest) => request,
  );
  return {
    transaction,
    save,
    validateChange,
    service: new AgentPlanSettings({
      access: { require: async () => previous },
      plans: { save },
      revise: async () => ({ ...previous, name: "Edited" }),
      teams: {
        validateChange,
        recordAdminAction: vi.fn(async () => undefined),
      },
    }),
  };
}

it("commits graph and team/owner change inside the same transaction and returns both revisions", async () => {
  const world = settingsWorld();
  const teams = [fullPlanTeam("user", "Mei")];
  expect(
    await world.service.save("admin", "plan-1", {
      plan: {},
      access: { revision: 4, teams, ownerId: "new-owner" },
    }),
  ).toBe(6);
  expect(writeAccess).toHaveBeenCalledWith(
    world.transaction,
    expect.objectContaining({
      planId: "plan-1",
      actorId: "admin",
      revision: 5,
      teams,
      ownerId: "new-owner",
    }),
  );
  expect(world.save).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Edited", ownerId: "owner" }),
    false,
    expect.any(Function),
    "admin",
  );
});

it("refuses invalid person rights before saving any graph", async () => {
  const world = settingsWorld();
  world.validateChange.mockRejectedValueOnce(
    new AgentError("plan_user_team_read_only"),
  );
  await expect(
    world.service.save("owner", "plan-1", {
      plan: {},
      access: {
        revision: 4,
        teams: [{ ...fullPlanTeam("user", "Mei"), canRun: true }],
      },
    }),
  ).rejects.toMatchObject({ code: "plan_user_team_read_only" });
  expect(world.save).not.toHaveBeenCalled();
});

it("refuses stale settings and keeps ordinary graph saves at a single new revision", async () => {
  const world = settingsWorld();
  await expect(
    world.service.save("owner", "plan-1", {
      plan: {},
      access: { revision: 3 },
    }),
  ).rejects.toMatchObject({ code: "plan_conflict" });
  expect(world.save).not.toHaveBeenCalled();
  expect(
    await world.service.save("owner", "plan-1", {
      plan: {},
      access: { revision: 4 },
    }),
  ).toBe(5);
  expect(world.save).toHaveBeenCalledWith(
    expect.any(Object),
    false,
    undefined,
    "owner",
  );
});

it("advertises contract version 18 through read_plan_capabilities", async () => {
  const result = await readPlanResources(
    partial({}),
    "reader",
    "plans.capabilities.read",
    {},
  );
  expect(result).toMatchObject({
    capabilities: { contractVersion: 18, cloneSharing: "create_default" },
  });
});

vi.mock(
  "@/backend/database/repositories/agents/AgentOperationKeyRepository",
  async () => ({
    AgentOperationKeyRepository: (await import("./agent-plan-command-fakes"))
      .FakeOperationKeyRepository,
  }),
);

it("routes update_plan graph and canonical teams through the same atomic settings save", async () => {
  const transaction: DatabaseTransaction = partial({});
  const current = planView({
    revision: 4,
    rights: {
      canRead: true,
      canEdit: true,
      canRun: true,
      canManageTeams: true,
      canChangeOwner: false,
      canDelete: true,
      isAdministrator: false,
      isAdminAccess: false,
    },
  });
  const save = vi.fn(async () => "plan-1");
  const changeAccess = vi.fn(async () => 5);
  const saveSettings = vi.fn<AgentPlanSettings["save"]>(
    async (user, planId, input) => {
      void user;
      void planId;
      await input.access.journal?.(transaction);
      return 6;
    },
  );
  const plans = {
    view: async () => current,
    agents: async () => [],
    sources: async () => ({ agents: [], tasks: [] }),
    workspaces: async () => [WORKSPACE],
    save,
    changeAccess,
    saveSettings,
  };
  const operations = new AgentPlanWriteOperations({
    plans,
    database: {
      transaction: async <T>(
        work: (transaction: DatabaseTransaction) => Promise<T>,
      ): Promise<T> => work(transaction),
    },
  });
  const teams = [fullPlanTeam("user", "Mei")];
  const result = await operations.write("owner", "plans.update", {
    operationId: "page330-update",
    planId: "plan-1",
    expectedRevision: 4,
    name: "Edited",
    teams,
  });
  expect(saveSettings).toHaveBeenCalledOnce();
  expect(saveSettings.mock.calls[0]).toMatchObject([
    "owner",
    "plan-1",
    {
      plan: { name: "Edited" },
      access: { revision: 4, teams },
    },
  ]);
  expect(save).not.toHaveBeenCalled();
  expect(changeAccess).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    result: { planId: "plan-1", changed: true, revision: 6 },
  });
});
