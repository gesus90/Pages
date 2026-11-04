import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentProfileRemoval } from "@/backend/database/repositories/agent/AgentProfileRemoval";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentProfileStore } from "@/backend/database/repositories/agent/AgentProfileStore";
import { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import { AgentWorkspaceReferencesRepository } from "@/backend/database/repositories/agent/AgentWorkspaceReferencesRepository";
import { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import {
  OTHER_USER,
  OWNER,
  planFixture,
  profileFixture,
  PROJECT,
  runFixture,
  snapshotFixture,
} from "./plan-fixtures";
import {
  call,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentWorkspace } from "@/definition/AgentWorkspace";

const WORKSPACE: AgentWorkspace = {
  id: "workspace-a",
  name: "Arbeitskopie A",
  path: "/srv/references/a",
  directoryIdentity: "identity-a",
  projectId: PROJECT,
  registeredBy: OWNER,
  revision: 1,
};
const FREE_CLEANUP = {
  workspaceId: "workspace-cleanup",
  workspaceName: "Aufräumen",
  runId: "run-references",
  ownerId: OWNER,
  blocker: "cleanup_requested",
  updatedAt: "2026-03-01 08:00:00",
};

/** A plan with a node nested in a group, for the walk through a whole document. */
function planWithAgent(id: string, agentId: string): AgentPlan {
  return planFixture(id, {
    name: `Verwendet ${id}`,
    nodes: planFixture(id).nodes.map((node) =>
      node.type === "agent" ? { ...node, agentId } : node,
    ),
  });
}

function planWithWorkspace(id: string, workspaceId: string): AgentPlan {
  return planFixture(id, {
    name: `Verzeichnis ${id}`,
    nodes: [
      ...planFixture(id).nodes,
      {
        id: "directory",
        type: "parameter",
        name: "repository",
        format: "string",
        value: { type: "workspace", workspaceId },
        x: 0,
        y: 320,
      },
    ],
  });
}

function profiles({ database }: RepositoryWorld): AgentProfileRepository {
  return new AgentProfileRepository(database);
}

function store({ database }: RepositoryWorld): AgentProfileStore {
  return new AgentProfileStore(database);
}

function workspaces({ database }: RepositoryWorld): AgentWorkspaceRepository {
  return new AgentWorkspaceRepository(database);
}

function references({
  database,
}: RepositoryWorld): AgentWorkspaceReferencesRepository {
  return new AgentWorkspaceReferencesRepository(database);
}

function cleanups({
  database,
}: RepositoryWorld): AgentWorkspaceCleanupRepository {
  return new AgentWorkspaceCleanupRepository(database);
}

/** Agents, their scopes and what still uses them. */
export const PROFILE_FLOW: RepositoryFlow = {
  title: "agent profiles",
  steps: [
    call("AgentProfileRepository.save", (world) =>
      profiles(world).save(
        profileFixture("profile-b", {
          name: "beta",
          targets: [
            { kind: "person", targetId: "user-b" },
            { kind: "group", targetId: "group-a" },
          ],
          purposes: ["chat", "agent"],
        }),
        () => Promise.resolve(),
      ),
    ),
    call("AgentProfileStore.save", ({ database }) =>
      database.transaction((transaction) =>
        new AgentProfileStore(transaction).save(
          profileFixture("profile-a", {
            name: "Alpha",
            reasoningEffort: "high",
            isActive: false,
          }),
        ),
      ),
    ),
    call("AgentProfileRepository.save", (world) =>
      profiles(world).save(
        profileFixture("profile-own", {
          name: "ALPHA",
          ownerId: OTHER_USER,
          modelProfileId: "profile-a",
          targets: [{ kind: "person", targetId: "user-b" }],
        }),
      ),
    ),
    refused("AgentProfileRepository.save", (world) =>
      profiles(world).save(
        profileFixture("profile-own-2", {
          ownerId: OTHER_USER,
          modelProfileId: "profile-missing",
        }),
      ),
    ),
    refused("AgentProfileRepository.save", (world) =>
      profiles(world).save(profileFixture("profile-a", { revision: 9 })),
    ),
    call("AgentProfileRepository.save", (world) =>
      profiles(world).save(
        profileFixture("profile-system", {
          name: "System",
          targets: [{ kind: "system", targetId: "skills" }],
        }),
      ),
    ),
    refused("AgentProfileRepository.save", (world) =>
      profiles(world).save(
        profileFixture("profile-system-2", {
          name: "System 2",
          targets: [{ kind: "system", targetId: "skills" }],
        }),
      ),
    ),
    reversedInPostgres("agent_execution_profiles"),
    reversedInPostgres("agent_profile_targets"),
    reversedInPostgres("agent_profile_purposes"),
    call("AgentProfileRepository.list", async (world) =>
      (await profiles(world).list()).filter((profile) =>
        profile.id.startsWith("profile-"),
      ),
    ),
    call("AgentProfileStore.list", async ({ database }) =>
      (await new AgentProfileStore(database).list()).filter((profile) =>
        profile.id.startsWith("profile-"),
      ),
    ),
    call("AgentProfileStore.references", (world) =>
      store(world).references({ kind: "person", targetId: "user-b" }),
    ),
    call("AgentProfileRepository.save", (world) =>
      profiles(world).save(
        profileFixture("profile-a", {
          name: "Alpha",
          revision: 1,
          configuration: {
            ...emptyAgentConfiguration("person"),
            sharing: {
              isGlobal: false,
              targets: [{ kind: "person", targetId: "user-c" }],
            },
          },
        }),
      ),
    ),
    prepare(`
      INSERT INTO agent_legacy_function_assignments (function, profile_id)
      VALUES ('skills', 'profile-system'), ('zeta', 'profile-system');
    `),
    reversedInPostgres("agent_legacy_function_assignments"),
    call("AgentProfileRepository.usages", (world) =>
      profiles(world).usages("profile-system"),
    ),
    call("AgentProfileRepository.usages", (world) =>
      profiles(world).usages("profile-own"),
    ),
    call("AgentProfileRepository.usages", (world) =>
      profiles(world).usages("profile-missing"),
    ),
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(
        planWithAgent("plan-uses-z", "profile-a"),
        true,
      ),
    ),
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(
        planWithAgent("plan-uses-a", "profile-a"),
        true,
      ),
    ),
    ...["m", "b", "y", "e", "q", "h"].map((letter) =>
      call("AgentPlanRepository.save", ({ database }) =>
        new AgentPlanRepository(database).save(
          planWithAgent(`plan-uses-${letter}`, "profile-a"),
          true,
        ),
      ),
    ),
    reversedInPostgres("agent_plans"),
    call("AgentProfileStore.usages", (world) =>
      store(world).usages("profile-a"),
    ),
    refused("AgentProfileRepository.remove", (world) =>
      profiles(world).remove("profile-a"),
    ),
    refused("AgentProfileStore.remove", ({ database }) =>
      database.transaction((transaction) =>
        new AgentProfileStore(transaction).remove("profile-a", 9),
      ),
    ),
    refused("AgentProfileRemoval.remove", ({ database }) =>
      database.transaction((transaction) =>
        new AgentProfileRemoval(transaction).remove("profile-missing"),
      ),
    ),
    refused("AgentProfileRemoval.remove", ({ database }) =>
      database.transaction((transaction) =>
        new AgentProfileRemoval(transaction).remove("profile-own"),
      ),
    ),
    call("AgentProfileRepository.removeWithReferences", (world) =>
      profiles(world).removeWithReferences("profile-a"),
    ),
    stored(
      "SELECT id, model_profile_id, revision FROM agent_execution_profiles WHERE id LIKE 'profile-%' AND id NOT LIKE 'profile-plans' ORDER BY id;",
    ),
    call("AgentPlanRepository.find", ({ database }) =>
      new AgentPlanRepository(database).find("plan-uses-a"),
    ),
    call("AgentProfileRemoval.remove", ({ database }) =>
      database.transaction((transaction) =>
        new AgentProfileRemoval(transaction).remove("profile-system"),
      ),
    ),
    stored(
      "SELECT COUNT(*) FROM agent_legacy_function_assignments WHERE profile_id = 'profile-system';",
    ),
    call("AgentProfileRepository.save", (world) =>
      profiles(world).save(profileFixture("profile-free", { name: "Frei" })),
    ),
    call("AgentProfileRepository.remove", (world) =>
      profiles(world).remove("profile-free", {
        expectedRevision: 1,
        journal: () => Promise.resolve(),
      }),
    ),
    call("AgentProfileStore.save", ({ database }) =>
      database.transaction((transaction) =>
        new AgentProfileStore(transaction).save(
          profileFixture("profile-free", { name: "Frei" }),
        ),
      ),
    ),
    call("AgentProfileStore.remove", ({ database }) =>
      database.transaction((transaction) =>
        new AgentProfileStore(transaction).remove("profile-free"),
      ),
    ),
    prepare(
      "UPDATE agent_execution_profiles SET configuration_json = 'kein JSON' WHERE id = 'profile-b';",
    ),
    refused("AgentProfileRepository.list", (world) => profiles(world).list()),
    prepare("DELETE FROM agent_execution_profiles WHERE id = 'profile-b';"),
  ],
};

/** Registering directories and what removing one does to plans, agents and runs. */
export const WORKSPACE_FLOW: RepositoryFlow = {
  title: "agent workspaces",
  steps: [
    call("AgentWorkspaceRepository.save", (world) =>
      workspaces(world).save(WORKSPACE, true, () => Promise.resolve()),
    ),
    call("AgentWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        {
          ...WORKSPACE,
          id: "workspace-b",
          name: "arbeitskopie b",
          path: "/srv/references/b",
          directoryIdentity: "identity-b",
        },
        true,
      ),
    ),
    reversedInPostgres("agent_workspaces"),
    call("AgentWorkspaceRepository.list", (world) => workspaces(world).list()),
    refused("AgentWorkspaceRepository.save", (world) =>
      workspaces(world).save(WORKSPACE, true),
    ),
    refused("AgentWorkspaceRepository.save", (world) =>
      workspaces(world).save({ ...WORKSPACE, revision: 7 }, false),
    ),
    refused("AgentWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        { ...WORKSPACE, id: "workspace-c", path: "/srv/references/a" },
        true,
      ),
    ),
    refused("AgentWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        { ...WORKSPACE, id: "workspace-c", path: "/srv/references/a/kind" },
        true,
      ),
    ),
    refused("AgentWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        { ...WORKSPACE, id: "workspace-c", path: "/srv/references" },
        true,
      ),
    ),
    call("AgentWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        { ...WORKSPACE, id: "workspace-c", path: "/srv/references/a_b" },
        true,
      ),
    ),
    call("AgentWorkspaceRepository.save", (world) =>
      workspaces(world).save({ ...WORKSPACE, name: "Neu" }, false),
    ),
    call("AgentWorkspaceRepository.usages", (world) =>
      workspaces(world).usages("workspace-a"),
    ),
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(
        planWithWorkspace("plan-references-b", "workspace-a"),
        true,
      ),
    ),
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(
        planFixture("plan-references-a", {
          name: "Verzeichnis eigen",
          workspaceId: "workspace-a",
        }),
        true,
      ),
    ),
    call("AgentProfileRepository.save", ({ database }) =>
      new AgentProfileRepository(database).save(
        profileFixture("profile-references", {
          name: "Verzeichnis",
          configuration: {
            ...emptyAgentConfiguration("person"),
            parameters: [
              {
                name: "repository",
                type: "workspace",
                description: "Arbeitskopie",
                isRequired: false,
                defaultValue: { type: "workspace", workspaceId: "workspace-a" },
              },
            ],
          },
        }),
      ),
    ),
    prepare(
      `
      INSERT INTO agent_plan_templates (id, owner_id, name, name_key, node_type, node_json)
      VALUES ('template-references', 'user-plan-owner', 'Vorlage', 'vorlage', 'parameter', $node);
    `,
      {
        node: JSON.stringify({
          id: "template-node",
          type: "parameter",
          name: "repository",
          format: "string",
          value: { type: "workspace", workspaceId: "workspace-a" },
          x: 0,
          y: 0,
        }),
      },
    ),
    call("AgentPlanRunRepository.create", ({ database }) =>
      new AgentPlanRunRepository(database).create(
        runFixture("run-references", "plan-references-a"),
        snapshotFixture(
          planFixture("plan-references-a", { workspaceId: "workspace-a" }),
        ),
        ["workspace-a"],
      ),
    ),
    prepare(
      `
      INSERT INTO agent_plan_continuations (run_id, version, plan_revision, adopted_at, boundary_json, snapshot_json)
      VALUES ('run-continuation-ref', 1, 1, '2026-03-01', '{}', $snapshot);
    `,
      {
        snapshot: JSON.stringify(
          snapshotFixture(planWithWorkspace("plan-other", "workspace-a")),
        ),
      },
    ),
    prepare(
      `
      INSERT INTO agent_plan_runs (id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json)
      VALUES ('run-continuation-ref', 'plan-other', 'user-plan-owner', 'project-plans', 'workspace-other', '2026-03-01', 'running', $view, $snapshot);
    `,
      {
        view: JSON.stringify(runFixture("run-continuation-ref", "plan-other")),
        snapshot: JSON.stringify(snapshotFixture(planFixture("plan-other"))),
      },
    ),
    reversedInPostgres("agent_plans"),
    call("AgentWorkspaceRepository.usages", (world) =>
      workspaces(world).usages("workspace-a"),
    ),
    call("AgentWorkspaceReferencesRepository.usages", (world) =>
      references(world).usages("workspace-a"),
    ),
    call("AgentWorkspaceReferencesRepository.usages", (world) =>
      references(world).usages("workspace-none"),
    ),
    refused("AgentWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        { ...WORKSPACE, revision: 2, path: "/srv/references/andere" },
        false,
      ),
    ),
    call("AgentWorkspaceReferencesRepository.requireReferences", (world) =>
      references(world).requireReferences({
        nested: [{ workspaceId: "workspace-b" }, { workspaceId: "" }],
      }),
    ),
    refused("AgentWorkspaceReferencesRepository.requireReferences", (world) =>
      references(world).requireReferences({ workspaceId: "workspace-none" }),
    ),
    refused("AgentWorkspaceRepository.remove", (world) =>
      workspaces(world).remove("workspace-none", 1),
    ),
    refused("AgentWorkspaceRepository.remove", (world) =>
      workspaces(world).remove("workspace-a", 99),
    ),
    call("AgentWorkspaceRepository.remove", (world) =>
      workspaces(world).remove(
        "workspace-a",
        2,
        () => Promise.resolve(),
        OTHER_USER,
      ),
    ),
    stored(`
      SELECT workspace_id, run_id, owner_id, removed_by, workspace_name, state, blocker
      FROM agent_workspace_cleanup
      WHERE workspace_id = 'workspace-a'
      ORDER BY run_id;
    `),
    stored(`
      SELECT id, workspace_id, revision
      FROM agent_plans
      WHERE id LIKE 'plan-references-%'
      ORDER BY id;
    `),
    call("AgentPlanRepository.find", ({ database }) =>
      new AgentPlanRepository(database).find("plan-references-b"),
    ),
    stored(
      "SELECT node_json FROM agent_plan_templates WHERE id = 'template-references';",
    ),
    stored(
      "SELECT configuration_json, revision FROM agent_execution_profiles WHERE id = 'profile-references';",
    ),
    call("AgentPlanRunRepository.find", ({ database }) =>
      new AgentPlanRunRepository(database).find("run-references"),
    ),
    call("AgentWorkspaceReferencesRepository.usages", (world) =>
      references(world).usages("workspace-a"),
    ),
    call("AgentWorkspaceReferencesRepository.detach", ({ database }) =>
      database.transaction((transaction) =>
        new AgentWorkspaceReferencesRepository(transaction).detach(
          "workspace-b",
          { userId: OWNER, name: "B" },
        ),
      ),
    ),
    prepare(
      "UPDATE agent_plan_runs SET status = 'failed' WHERE id IN ('run-references', 'run-continuation-ref');",
    ),
  ],
};

/** The cleanup obligations a removed directory leaves behind. */
export const WORKSPACE_CLEANUP_FLOW: RepositoryFlow = {
  title: "agent workspace cleanup",
  steps: [
    prepare(`
      INSERT INTO agent_workspace_cleanup (workspace_id, run_id, owner_id, removed_by, workspace_name, updated_at)
      VALUES
          ('workspace-cleanup', 'run-references', 'user-plan-owner', 'user-plan-owner', 'Aufräumen', '2026-03-01 08:00:00'),
          ('workspace-cleanup-2', 'run-references', 'user-plan-owner', 'user-plan-owner', 'Aufräumen 2', '2026-03-01 08:00:00'),
          ('workspace-cleanup-3', 'run-references', 'user-plan-other', 'user-plan-owner', 'Aufräumen 3', '2020-01-01 08:00:00');
    `),
    // Earlier flows wrote their rows at the clock, in another second per database.
    prepare(
      "UPDATE agent_workspace_cleanup SET updated_at = '2026-02-01 00:00:00' WHERE workspace_id NOT LIKE 'workspace-cleanup%';",
    ),
    reversedInPostgres("agent_workspace_cleanup"),
    call("AgentWorkspaceCleanupRepository.pending", (world) =>
      cleanups(world).pending(),
    ),
    call("AgentWorkspaceCleanupRepository.forPlan", (world) =>
      cleanups(world).forPlan(OWNER, "plan-references-a"),
    ),
    call("AgentWorkspaceCleanupRepository.forPlan", (world) =>
      cleanups(world).forPlan(OTHER_USER, "plan-none"),
    ),
    call("AgentWorkspaceCleanupRepository.record", (world) =>
      cleanups(world).record(FREE_CLEANUP, "pending", "processes_remaining"),
    ),
    stored(
      "SELECT state, blocker FROM agent_workspace_cleanup WHERE workspace_id = 'workspace-cleanup';",
    ),
    call("AgentWorkspaceCleanupRepository.record", (world) =>
      cleanups(world).record(FREE_CLEANUP, "completed", "none"),
    ),
    call("AgentWorkspaceCleanupRepository.record", (world) =>
      cleanups(world).record(
        { ...FREE_CLEANUP, ownerId: OTHER_USER },
        "pending",
        "unchanged",
      ),
    ),
    stored(
      "SELECT state, blocker, length(updated_at) FROM agent_workspace_cleanup WHERE workspace_id = 'workspace-cleanup';",
    ),
    call("AgentWorkspaceCleanupRepository.forPlan", (world) =>
      cleanups(world).forPlan(OWNER, "plan-references-a"),
    ),
    refusedWithoutTable(
      "AgentWorkspaceCleanupRepository.pending",
      "agent_workspace_cleanup",
      (transaction) =>
        new AgentWorkspaceCleanupRepository(transaction).pending(),
    ),
    prepare(
      "DELETE FROM agent_workspace_cleanup WHERE workspace_id LIKE 'workspace-cleanup%';",
    ),
  ],
};
