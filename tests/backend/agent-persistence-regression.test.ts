import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import { AgentProfileStore } from "@/backend/database/repositories/agent/AgentProfileStore";
import { hasAgentUsage } from "@/backend/auth/AgentProfilePolicy";
import { TextAgentRoleService } from "@/backend/service/assistant/TextAgentRoleService";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import {
  createExecutionPlanHarness,
  executionPlan,
} from "../helpers/execution-plans";
import { useMigratedDatabase } from "../helpers/test-database";
import { createAccess } from "../helpers/authorization";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { ExecutionPlanHarness } from "../helpers/execution-plans";

describe("A10 transactional persistence and corrupt-state regression", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
  });
  async function setup(): Promise<ExecutionPlanHarness> {
    harness = await createExecutionPlanHarness(getDatabase());
    return harness;
  }

  it("checks workspace context and saved revision atomically and keeps a failed run insert from reserving directories", async () => {
    const current = await setup();
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId),
    );
    const plan = await current.planRepository.find(id);
    if (!plan) throw new Error("Missing plan fixture");
    await expect(
      current.planRepository.save({ ...plan, projectId: "different" }, false),
    ).rejects.toMatchObject({ code: "plan_context_changed" });
    await expect(
      current.planRepository.save({ ...plan, workspaceId: "missing" }, false),
    ).rejects.toMatchObject({ code: "plan_context_changed" });
    const snapshot = await current.preparation.prepare(current.bob.id, plan);
    const run: AgentPlanRun = {
      id: "stale",
      planId: plan.id,
      planName: plan.name,
      planRevision: 2,
      userId: current.bob.id,
      startedAt: "now",
      status: "running",
      stopRequested: false,
      steps: [],
    };
    await expect(
      current.runRepository.create(run, snapshot, [current.workspaceId]),
    ).rejects.toMatchObject({ code: "plan_conflict" });
    await expect(
      current.runRepository.create({ ...run, planId: "missing" }, snapshot, [
        current.workspaceId,
      ]),
    ).rejects.toMatchObject({ code: "plan_conflict" });
    expect(
      await getDatabase().query(
        "SELECT workspace_id FROM agent_plan_workspace_locks;",
      ),
    ).toEqual([]);
    await expect(
      current.runRepository.resources("missing"),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    expect(await current.runRepository.find("missing")).toBeNull();
    await current.runRepository.create(
      { ...run, planRevision: 1 },
      snapshot,
      [],
    );
    expect(
      await current.runRepository.list(current.bob.id, plan.id),
    ).toHaveLength(1);
    expect(await current.runRepository.list(current.alice.id, plan.id)).toEqual(
      [],
    );
    await getDatabase().execute(
      "UPDATE agent_plan_runs SET view_json = 'null' WHERE id = $id;",
      { id: run.id },
    );
    expect(await current.runRepository.find(run.id)).toBeNull();
  });

  it("rejects duplicate or stale registrations and unknown unregister operations", async () => {
    const current = await setup();
    const workspace = (await current.workspaceRepository.list())[0];
    await expect(
      current.workspaceRepository.save(workspace, true),
    ).rejects.toMatchObject({ code: "workspace_conflict" });
    await expect(
      current.workspaceRepository.save({ ...workspace, id: "missing" }, false),
    ).rejects.toMatchObject({ code: "workspace_conflict" });
    await expect(
      current.workspaceRepository.remove("missing", 1),
    ).rejects.toMatchObject({ code: "workspace_not_found" });
    await expect(
      current.workspaceRepository.remove(current.workspaceId, 2),
    ).rejects.toMatchObject({ code: "workspace_conflict" });
  });

  it("rejects corrupt grant kinds and purposes rather than exposing partial registrations or agents", async () => {
    const current = await setup();
    const database = getDatabase();
    const query = vi.spyOn(database, "query");
    query
      .mockResolvedValueOnce([
        [
          "profile",
          "Name",
          "connection",
          "model-a",
          null,
          1,
          JSON.stringify(emptyAgentConfiguration()),
          1,
        ],
      ])
      .mockResolvedValueOnce([["profile", "unexpected-purpose"]])
      .mockResolvedValueOnce([]);
    await expect(new AgentProfileStore(database).list()).rejects.toMatchObject({
      code: "profile_invalid",
    });
    query
      .mockResolvedValueOnce([
        [
          "profile",
          "Name",
          "connection",
          "model-a",
          null,
          1,
          JSON.stringify(emptyAgentConfiguration()),
          1,
        ],
      ])
      .mockResolvedValueOnce([["profile", "agent"]])
      .mockResolvedValueOnce([["profile", "unexpected-scope", "target"]]);
    await expect(new AgentProfileStore(database).list()).rejects.toMatchObject({
      code: "profile_invalid",
    });
    const transaction = vi.spyOn(database, "transaction");
    transaction.mockImplementationOnce(async (operation) =>
      operation({
        execute: async () => undefined,
        query: async (sql) =>
          sql.includes("agent_workspace_targets")
            ? [["workspace", "system", "agent"]]
            : [
                [
                  "workspace",
                  "Name",
                  "/approved/one",
                  "identity",
                  "project",
                  "alice",
                  1,
                ],
              ],
      }),
    );
    await expect(current.workspaceRepository.list()).rejects.toMatchObject({
      code: "workspace_invalid",
    });
  });

  it("retains legacy configuration defaults while withdrawing only selected function targets", async () => {
    const current = await setup();
    const profiles = await current.profileRepository.list();
    const profile = profiles.find((entry) => entry.id === current.agentId);
    if (!profile) throw new Error("Missing profile fixture");
    const store = new AgentProfileStore(getDatabase());
    await expect(
      store.save({ ...profile, revision: 100 }),
    ).rejects.toMatchObject({ code: "profile_conflict" });
    await expect(
      store.save({ ...profile, id: "missing", revision: 1 }),
    ).rejects.toMatchObject({ code: "profile_conflict" });
    const legacy = {
      ...profile,
      id: "legacy-personal",
      revision: undefined,
      configuration: undefined,
      targets: [{ kind: "person" as const, targetId: current.bob.id }],
    };
    await store.save(legacy);
    expect(await store.usages("missing")).toEqual([]);
    vi.spyOn(store, "list").mockResolvedValueOnce([legacy]);
    expect(await store.usages(legacy.id)).toEqual([
      { kind: "assignment", target: legacy.targets[0] },
    ]);
    expect(
      (await current.profileRepository.list()).find(
        (entry) => entry.id === legacy.id,
      )?.configuration?.scope,
    ).toBe("person");
    expect(
      hasAgentUsage(legacy, {
        actor: createAccess({ userId: current.bob.id }),
        groupIds: [],
      }),
    ).toBe(true);
    const assignments = new AgentAssignmentRepository(getDatabase());
    await assignments.remove("text");
    await assignments.remove("skills");
    expect(
      (await current.profileRepository.list()).some((entry) =>
        entry.targets.some(
          (target) => target.kind === "system" && target.targetId === "chat",
        ),
      ),
    ).toBe(true);
    await assignments.save({
      function: "text",
      connectionId: "connection",
      model: "model-a",
      reasoningEffort: "medium",
    });
    const role = new TextAgentRoleService(
      current.settings,
      current.connections,
    );
    await getDatabase().execute(
      "INSERT INTO agent_profile_purposes (profile_id, purpose) VALUES ($id, 'chat');",
      { id: profile.id },
    );
    await getDatabase().execute(
      "INSERT INTO agent_profile_targets (profile_id, kind, target_id) VALUES ($id, 'system', 'chat');",
      { id: profile.id },
    );
    await expect(role.resolve(undefined, "chat")).rejects.toMatchObject({
      code: "profileSelectionRequired",
    });
  });
});
