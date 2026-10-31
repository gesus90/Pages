import { describe, expect, it, vi } from "vitest";

import { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import { AgentPlanSharing } from "@/backend/service/agents/AgentPlanSharing";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type {
  AgentPlanListing,
  AgentPlanRepository,
} from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentPlanWorkspaces } from "@/backend/service/agents/AgentPlanWorkspaces";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AccountAccess } from "@/definition/Authorization";

const ME = "me";
const PROJECT = "project-1";
const WORKSPACE = "workspace-1";

const ACCOUNT: AccountAccess = {
  userId: ME,
  role: null,
  isAdmin: false,
  mode: "role",
  firstName: "Me",
  lastName: "Tester",
  isActive: true,
  departments: ["team-a"],
  managedDepartments: [],
  allDepartments: false,
  allProjects: false,
  hasHadDepartment: true,
};

const CHOICE: AgentWorkspaceChoice = {
  id: WORKSPACE,
  name: "Main",
  path: "/work/main",
  projectId: PROJECT,
  projectName: "Project one",
  github: null,
  isUsable: true,
  reason: null,
};

function listing(
  id: string,
  overrides: Partial<AgentPlanListing> = {},
): AgentPlanListing {
  return {
    id,
    name: id,
    ownerId: ME,
    projectId: PROJECT,
    workspaceId: WORKSPACE,
    departmentId: null,
    usage: "private",
    revision: 3,
    ...overrides,
  };
}

function planOf(entry: AgentPlanListing): AgentPlan {
  return { ...entry, globals: {}, nodes: [], edges: [] };
}

interface World {
  readonly access: AgentPlanAccess;
  readonly list: ReturnType<typeof vi.fn>;
  readonly listings: ReturnType<typeof vi.fn>;
  readonly find: ReturnType<typeof vi.fn>;
  readonly registeredIds: ReturnType<typeof vi.fn>;
  readonly projects: ReturnType<typeof vi.fn>;
}

function worldOf(
  entries: readonly AgentPlanListing[],
  options: {
    readonly workspaces?: readonly AgentWorkspaceChoice[];
    readonly registered?: readonly string[];
    readonly projects?: ReadonlyMap<
      string,
      { projectName: string; github: null }
    >;
  } = {},
): World {
  const list = vi.fn(async () => entries.map(planOf));
  const listings = vi.fn(async () => entries);
  const find = vi.fn(
    async (id: string) =>
      entries.map(planOf).find((plan) => plan.id === id) ?? null,
  );
  const registeredIds = vi.fn(async () => new Set(options.registered ?? []));
  const projects = vi.fn(async () => options.projects ?? new Map());
  const sharing = new AgentPlanSharing(
    partial({ snapshot: async () => ({ accounts: [ACCOUNT] }) }),
    partial({ findIdsByMember: async () => [] }),
  );
  const access = new AgentPlanAccess(
    partial<AgentPlanRepository>({ list, listings, find }),
    partial<AgentWorkspaceService>({}),
    sharing,
    partial<AgentPlanWorkspaces>({
      choices: async () => options.workspaces ?? [CHOICE],
      registeredIds,
      projects,
    }),
  );
  return { access, list, listings, find, registeredIds, projects };
}

describe("the summaries of the plans a person reads", () => {
  it("name, place and rights of each readable plan, without loading a graph", async () => {
    const world = worldOf([
      listing("own"),
      listing("shared", {
        ownerId: "someone",
        usage: "workspace",
        revision: 7,
      }),
      listing("hidden", { ownerId: "someone", usage: "private" }),
      listing("team", {
        ownerId: "someone",
        usage: "private",
        departmentId: "team-a",
      }),
    ]);

    const summaries = await world.access.summaries(ME);

    expect(summaries).toEqual([
      expect.objectContaining({
        id: "own",
        projectName: "Project one",
        revision: 3,
        canEdit: true,
      }),
      expect.objectContaining({ id: "shared", revision: 7, canEdit: false }),
      expect.objectContaining({ id: "team", canEdit: true }),
    ]);
    expect(world.list).not.toHaveBeenCalled();
    expect(world.listings).toHaveBeenCalledTimes(1);
    expect(summaries.every((entry) => !("nodes" in entry))).toBe(true);
  });

  it("reads the project facts of repairable plans only when a plan needs them", async () => {
    const world = worldOf([listing("own"), listing("other", { ownerId: ME })]);

    await world.access.summaries(ME);

    expect(world.registeredIds).not.toHaveBeenCalled();
    expect(world.projects).not.toHaveBeenCalled();
  });

  it("keeps a plan whose registration is gone repairable, once, and drops one it cannot see", async () => {
    const world = worldOf(
      [
        listing("orphan", { workspaceId: "gone" }),
        listing("orphan-too", { workspaceId: "gone" }),
        listing("hidden-workspace", { workspaceId: "exists" }),
        listing("other-project", { workspaceId: "gone", projectId: "p2" }),
      ],
      {
        registered: ["exists"],
        projects: new Map([
          [PROJECT, { projectName: "Project one", github: null }],
        ]),
      },
    );

    const summaries = await world.access.summaries(ME);

    expect(summaries.map((entry) => entry.id)).toEqual([
      "orphan",
      "orphan-too",
    ]);
    expect(summaries.every((entry) => entry.isWorkspaceMissing)).toBe(true);
    expect(world.registeredIds).toHaveBeenCalledTimes(1);
    expect(world.projects).toHaveBeenCalledTimes(1);
  });

  it("leaves a plan in a workspace of another project out", async () => {
    const world = worldOf([listing("p", { projectId: "p2" })]);

    await expect(world.access.summaries(ME)).resolves.toEqual([]);
  });
});

describe("requiring one plan", () => {
  it("reads only that plan and answers with the whole plan and the rights to it", async () => {
    const world = worldOf([listing("one"), listing("two")]);

    const plan = await world.access.require(ME, "two");

    expect(plan).toMatchObject({
      id: "two",
      canEdit: true,
      projectName: "Project one",
      nodes: [],
      edges: [],
    });
    expect(world.find).toHaveBeenCalledWith("two");
    expect(world.list).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "a plan that does not exist",
      id: "missing",
      entry: listing("one"),
    },
    {
      label: "a private plan of someone else",
      id: "private",
      entry: listing("private", { ownerId: "someone" }),
    },
    {
      label: "a plan of a workspace the person does not see",
      id: "foreign",
      entry: listing("foreign", { projectId: "p2" }),
    },
  ])("refuses $label", async ({ id, entry }) => {
    const world = worldOf([entry]);

    await expect(world.access.require(ME, id)).rejects.toMatchObject({
      code: "plan_access_denied",
    });
  });

  it("marks a plan whose registration is gone", async () => {
    const world = worldOf([listing("orphan", { workspaceId: "gone" })], {
      projects: new Map([
        [PROJECT, { projectName: "Project one", github: null }],
      ]),
    });

    await expect(world.access.require(ME, "orphan")).resolves.toMatchObject({
      isWorkspaceMissing: true,
      projectName: "Project one",
    });
  });
});

describe("listing the whole plans", () => {
  it("keeps the order and the decisions of the summaries", async () => {
    const world = worldOf(
      [
        listing("own"),
        listing("hidden", { ownerId: "someone" }),
        listing("orphan", { workspaceId: "gone" }),
      ],
      {
        projects: new Map([
          [PROJECT, { projectName: "Project one", github: null }],
        ]),
      },
    );

    const plans = await world.access.list(ME);
    const summaries = await world.access.summaries(ME);

    expect(plans.map((plan) => plan.id)).toEqual(["own", "orphan"]);
    expect(summaries.map((entry) => entry.id)).toEqual(
      plans.map((plan) => plan.id),
    );
    expect(plans[1].isWorkspaceMissing).toBe(true);
  });
});
