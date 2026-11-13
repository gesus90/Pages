import { expect, it, vi } from "vitest";

import { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import { AgentPlanSharing } from "@/backend/service/agents/AgentPlanSharing";
import { AgentPlanControlService } from "@/backend/service/agents/AgentPlanControlService";
import { readPlanControlEntry } from "@/backend/service/agents/AgentPlanControlViews";
import { planDetail } from "@/backend/service/agents/AgentPlanOperationViews";
import { fullPlanTeam } from "@/definition/AgentPlanTeam";

import { CloneWorld } from "./agent-plan-cloning-fixture";
import { ADMIN } from "./agent-plan-service-harness";
import { partial } from "../../../app/lib/service-wiring-fakes";

vi.mock("@/backend/database/repositories/agent/AgentPlanRepository", () => ({
  requirePlanRevision: vi.fn(async () => undefined),
}));
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanAuditRepository",
  () => ({
    AgentPlanAuditRepository: class {
      public readonly append = vi.fn(async () => undefined);
    },
  }),
);

it("lets the person selected while cloning read the copy and reports exactly read-only control rights", async () => {
  const world = new CloneWorld();
  const teams = [fullPlanTeam("user", "Mei")];
  await world.clone({ name: "Copy", expectedRevision: 7, teams });
  const copy = world.saved[0];
  if (!copy) throw new Error("missing committed copy");
  const sharing = new AgentPlanSharing(
    partial({
      snapshot: async () => ({
        accounts: [
          {
            ...ADMIN,
            userId: "Mei",
            firstName: "Mei",
            lastName: "Reader",
            isAdmin: false,
            mode: "role",
          },
        ],
        departments: [],
      }),
    }),
    partial({ findIdsByMember: async () => [], findAll: async () => [] }),
  );
  const access = new AgentPlanAccess(
    partial({ find: async () => copy }),
    partial({ choices: world.choices }),
    sharing,
  );
  const plan = await access.require("Mei", copy.id);
  expect(plan).toMatchObject({
    teams,
    canEdit: false,
    rights: {
      canRead: true,
      canEdit: false,
      canRun: false,
      canManageTeams: false,
      canDelete: false,
    },
  });
  const result = planDetail(plan, {
    directory: await access.directory("Mei"),
    sources: { agents: [], tasks: [] },
    entries: [],
    starters: new Map(),
  });
  expect(result.teams).toEqual([
    {
      kind: "user",
      id: "Mei",
      name: "Mei Reader",
      read: true,
      edit: false,
      run: false,
    },
  ]);
  const catalog = vi.fn(async () => []);
  const controls = new AgentPlanControlService({
    access,
    runs: partial({ latest: async () => null }),
    profiles: { catalog },
  });
  const control = await readPlanControlEntry(
    partial({
      view: async () => plan,
      control: (userId: string, planId: string) =>
        controls.read(userId, planId),
    }),
    "Mei",
    copy.id,
  );
  expect(control).toMatchObject({
    canEdit: false,
    canDelete: false,
    canPlay: false,
    canPause: false,
    canResume: false,
    canStop: false,
    issue: "plan_read_only",
    blockers: { play: "plan_read_only" },
  });
  expect(catalog).not.toHaveBeenCalled();
});
