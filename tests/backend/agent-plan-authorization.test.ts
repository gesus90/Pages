import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { createCatalogModel } from "../helpers/agents";
import { createAccess, createRole } from "../helpers/authorization";
import {
  controlExecution,
  createExecutionPlanHarness,
  executionPlan,
  executionStep,
  waitForPlan,
} from "../helpers/execution-plans";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AgentProfileInput } from "@/definition/AgentProfile";
import type { AgentPlanRun } from "@/definition/AgentPlan";

type PlanHarness = Awaited<ReturnType<typeof createExecutionPlanHarness>>;

async function addCliAgent(current: PlanHarness): Promise<string> {
  await current.connections.insert({
    id: "cli",
    name: "Synthetic CLI",
    provider: "codex_cli",
    secretEncrypted: null,
    testModel: null,
    actorId: current.alice.id,
  });
  await current.connections.setCliAccount(
    "cli",
    { loggedInAt: "now", label: "Synthetic" },
    current.alice.id,
  );
  await current.connections.catalogs().save(
    "cli",
    {
      attemptedAt: "now",
      errorCode: null,
      models: [
        createCatalogModel({
          id: "model-a",
          reasoning: "levels",
          reasoningEfforts: ["medium"],
        }),
      ],
    },
    null,
  );
  const input: AgentProfileInput = {
    ...current.agentInput,
    name: "Writing worker",
    connectionId: "cli",
    targets: [{ kind: "person", targetId: current.bob.id }],
    configuration: {
      ...emptyAgentConfiguration(),
      projectId: "project",
      sharing: { isGlobal: true, targets: [] },
      directoryParameter: "workspace",
      markdown: "Edit {{workspace.path}}",
      parameters: [
        {
          name: "workspace",
          type: "workspace",
          description: "Directory",
          isRequired: true,
          defaultValue: { type: "workspace", workspaceId: current.workspaceId },
        },
      ],
    },
  };
  return current.profiles.save(current.admin, null, input);
}

describe("A10.4 preflight, live authorization and working-copy reservations", () => {
  const getDatabase = useMigratedDatabase();
  let harness: PlanHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });
  async function setup(): Promise<PlanHarness> {
    harness = await createExecutionPlanHarness(getDatabase());
    return harness;
  }

  it("keeps private graphs private, allows shared usage, and rejects edits or runs by other users", async () => {
    const current = await setup();
    const plan = executionPlan(current.workspaceId, current.agentId);
    const id = await current.service.save(current.bob.id, null, {
      ...plan,
      ownerId: current.alice.id,
      projectId: "forged",
    });
    expect((await current.planRepository.find(id))?.ownerId).toBe(
      current.bob.id,
    );
    await expect(
      current.service.page(current.alice.id, { planId: id, workspaceId: null }),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    await expect(
      current.service.play(current.reader.id, id, 1),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    await current.service.save(current.bob.id, id, {
      ...plan,
      revision: 1,
      usage: "workspace",
    });
    expect(
      (
        await current.service.page(current.alice.id, {
          planId: id,
          workspaceId: null,
        })
      ).selected?.canEdit,
    ).toBe(false);
    await expect(
      current.service.save(current.alice.id, id, { ...plan, revision: 2 }),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    const run = await current.service.play(current.bob.id, id, 2);
    await expect(
      current.service.run(current.alice.id, run.id),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    await expect(
      current.service.stop(current.alice.id, run.id),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    await waitForPlan(async () =>
      expect((await current.service.run(current.bob.id, run.id)).status).toBe(
        "succeeded",
      ),
    );
  });

  it("rejects stale edits and Play, cycles, orphan ports, missing definitions, and foreign tasks without provider calls", async () => {
    const current = await setup();
    const plan = executionPlan(current.workspaceId, current.agentId, {
      nodes: [
        executionStep("A", current.agentId),
        executionStep("B", current.agentId),
      ],
    });
    const id = await current.service.save(current.bob.id, null, plan);
    await current.service.save(current.bob.id, id, {
      ...plan,
      revision: 1,
      name: "Changed",
    });
    for (const input of [plan, { ...plan, revision: 1 }])
      await expect(
        current.service.save(current.bob.id, id, input),
      ).rejects.toMatchObject({ code: "plan_conflict" });
    await expect(
      current.service.play(current.bob.id, id, 1),
    ).rejects.toMatchObject({ code: "plan_conflict" });
    await expect(
      current.service.save(current.bob.id, null, {
        ...plan,
        edges: [
          { from: "A", to: "B" },
          { from: "B", to: "A" },
        ],
      }),
    ).rejects.toMatchObject({ code: "plan_cycle" });
    await expect(
      current.service.save(current.bob.id, null, {
        ...plan,
        nodes: [
          executionStep("A", current.agentId, {
            input: { kind: "result", stepId: "B" },
          }),
          executionStep("B", current.agentId),
        ],
      }),
    ).rejects.toMatchObject({ code: "plan_binding_invalid" });
    await expect(
      current.service.save(current.bob.id, null, {
        ...plan,
        nodes: [executionStep("A", "missing")],
      }),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    await expect(
      current.service.save(current.bob.id, null, {
        ...plan,
        nodes: [{ id: "foreign", type: "task", taskId: "ticket", x: 0, y: 0 }],
      }),
    ).rejects.toMatchObject({ code: "plan_binding_invalid" });
    expect(current.execution.run).not.toHaveBeenCalled();
  });

  it("checks required parameters, catalog models and ready directories before reserving or starting", async () => {
    const current = await setup();
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: [
          executionStep("A", current.agentId, {
            input: { kind: "literal", value: null },
          }),
        ],
      }),
    );
    await expect(
      current.service.play(current.bob.id, id, 1),
    ).rejects.toMatchObject({ code: "parameter_required" });
    const normal = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId),
    );
    await current.connections
      .catalogs()
      .save(
        "connection",
        { attemptedAt: "now", errorCode: null, models: [] },
        null,
      );
    await expect(
      current.service.play(current.bob.id, normal, 1),
    ).rejects.toThrow();
    await current.connections.catalogs().save(
      "connection",
      {
        attemptedAt: "now",
        errorCode: null,
        models: [
          createCatalogModel({
            id: "model-a",
            reasoning: "levels",
            reasoningEfforts: ["medium"],
          }),
        ],
      },
      null,
    );
    const directory = path.join(current.root, "approved", "one");
    await rename(directory, `${directory}-old`);
    await mkdir(directory);
    await expect(
      current.service.play(current.bob.id, normal, 1),
    ).rejects.toMatchObject({ code: "workspace_path_changed" });
    expect(current.execution.run).not.toHaveBeenCalled();
    expect(
      await getDatabase().query("SELECT id FROM agent_plan_runs;"),
    ).toEqual([]);
  });

  it("reauthorizes definition usage at each actual step start and blocks the join after revocation", async () => {
    const current = await setup();
    const pending = controlExecution(current.execution);
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: ["A", "B", "D"].map((id) => executionStep(id, current.agentId)),
        edges: [
          { from: "A", to: "B" },
          { from: "B", to: "D" },
        ],
      }),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    const previous = (await current.profileRepository.list()).find(
      (entry) => entry.id === current.agentId,
    );
    if (!previous?.configuration) throw new Error("Missing fixture");
    await current.profiles.save(current.admin, current.agentId, {
      ...previous,
      configuration: {
        ...previous.configuration,
        sharing: {
          isGlobal: false,
          targets: [{ kind: "person", targetId: current.alice.id }],
        },
      },
    });
    pending.get("A")?.resolve("A");
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe("failed"),
    );
    expect(current.execution.run).toHaveBeenCalledTimes(1);
    expect((await current.runRepository.find(run.id))?.steps).toMatchObject([
      { status: "succeeded" },
      { status: "failed", error: "agent_usage_denied" },
      { status: "waiting", isBlocked: true },
    ]);
  });

  it("resolves the executing user's personal access again without borrowing the shared definition author's connection", async () => {
    const current = await setup();
    const pending = controlExecution(current.execution);
    await current.connections.insert({
      id: "personal",
      name: "Bob API",
      provider: "openrouter",
      secretEncrypted: "synthetic-bob-key",
      testModel: null,
      actorId: current.bob.id,
    });
    await current.connections.catalogs().save(
      "personal",
      {
        attemptedAt: "now",
        errorCode: null,
        models: [
          createCatalogModel({
            id: "model-a",
            reasoning: "levels",
            reasoningEfforts: ["medium"],
          }),
        ],
      },
      null,
    );
    await current.connections.checks().save(
      "personal",
      "auth",
      {
        status: "passed",
        errorCode: null,
        detail: {},
        durationMs: 1,
        checkedAt: "now",
      },
      current.bob.id,
    );
    const template = await current.profiles.save(current.admin, null, {
      ...current.agentInput,
      name: "Shared personal",
      targets: [{ kind: "person", targetId: current.alice.id }],
      configuration: {
        ...current.agentInput.configuration,
        ...emptyAgentConfiguration(),
        markdown: "Shared task",
        sharing: { isGlobal: true, targets: [] },
      },
    });
    const own = await current.profiles.save(current.admin, null, {
      ...current.agentInput,
      name: "Bob source",
      connectionId: "personal",
      targets: [{ kind: "person", targetId: current.bob.id }],
      configuration: emptyAgentConfiguration(),
    });
    const nodes = ["A", "B"].map((id) => ({
      ...executionStep(id, template),
      personalAgentId: own,
    }));
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, template, {
        nodes,
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    expect(current.execution.run.mock.calls[0][0].agent.connection.id).toBe(
      "personal",
    );
    expect(await current.profiles.usages(current.admin, own)).toContainEqual({
      kind: "plan",
      id,
    });
    await current.connections.setActive("personal", false, current.alice.id);
    pending.get("A")?.resolve("A");
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe("failed"),
    );
    expect(current.execution.run).toHaveBeenCalledTimes(1);
    expect((await current.runRepository.find(run.id))?.steps[1].error).toBe(
      "personal_access_missing",
    );
  });

  it("denies workspace use immediately after project access is withdrawn and rejects changed GitHub context", async () => {
    const current = await setup();
    const pending = controlExecution(current.execution);
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: ["A", "B"].map((id) => executionStep(id, current.agentId)),
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    await current.projects.upsertIntegration("project", {
      repoUrl: "https://github.com/example/changed",
      repoName: "example/changed",
      tokenHash: "synthetic",
      tokenEncrypted: "synthetic",
      syncIssues: false,
      syncStatus: false,
      syncComments: false,
      syncPullRequests: false,
      syncCommits: false,
      syncDirection: "pull",
      syncIntervalMinutes: 0,
      isConnected: true,
      lastSyncAt: null,
    });
    pending.get("A")?.resolve("A");
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe("failed"),
    );
    expect((await current.runRepository.find(run.id))?.steps[1].error).toBe(
      "plan_context_changed",
    );
    await current.wiki.addDepartment("engineering");
    await current.projects.setDepartments("project", ["engineering"]);
    const role = createRole({
      id: "scoped",
      permissions: [],
      departmentBound: true,
    });
    await current.authorization.saveRole(role);
    await current.authorization.saveAccount(
      createAccess({
        userId: current.bob.id,
        role,
        departments: [],
        managedDepartments: [],
      }),
    );
    await expect(
      current.service.run(current.bob.id, run.id),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    await expect(
      current.service.sources(current.bob.id, current.workspaceId),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
  });

  it("rejects unordered writes to one copy, permits ordered writes and protects copies across runs until confirmed completion", async () => {
    const current = await setup();
    const agentId = await addCliAgent(current);
    const pending = controlExecution(current.execution);
    const plan = executionPlan(current.workspaceId, agentId, {
      nodes: ["A", "B"].map((id) => executionStep(id, agentId)),
    });
    const id = await current.service.save(current.bob.id, null, plan);
    await expect(
      current.service.play(current.bob.id, id, 1),
    ).rejects.toMatchObject({ code: "plan_workspace_conflict" });
    await current.service.save(current.bob.id, id, {
      ...plan,
      revision: 1,
      edges: [{ from: "A", to: "B" }],
    });
    const run = await current.service.play(current.bob.id, id, 2);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    expect(current.execution.run.mock.calls[0][0].directory).toBe(
      path.join(current.root, "approved", "one"),
    );
    await expect(
      current.service.play(current.bob.id, id, 2),
    ).rejects.toMatchObject({ code: "plan_workspace_conflict" });
    await expect(
      current.workspaces.remove(current.admin.userId, current.workspaceId, 1),
    ).rejects.toMatchObject({ code: "workspace_in_use" });
    await expect(
      current.profiles.remove(current.admin, agentId),
    ).rejects.toMatchObject({ code: "profile_in_use" });
    pending.get("A")?.resolve("A");
    await waitForPlan(() => expect(pending.has("B")).toBe(true));
    pending.get("B")?.resolve("B");
    await waitForPlan(async () =>
      expect((await current.service.run(current.bob.id, run.id)).status).toBe(
        "succeeded",
      ),
    );
    expect(
      await getDatabase().query(
        "SELECT workspace_id FROM agent_plan_workspace_locks;",
      ),
    ).toEqual([]);
    const next = await current.service.play(current.bob.id, id, 2);
    await waitForPlan(async () =>
      expect(
        (await current.service.run(current.bob.id, next.id)).steps[0].status,
      ).toBe("running"),
    );
  });

  it("allows independent writing branches only when directory parameters select distinct registered copies", async () => {
    const current = await setup();
    const agentId = await addCliAgent(current);
    const pending = controlExecution(current.execution);
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, agentId, {
        nodes: [
          executionStep("A", agentId),
          executionStep("B", agentId, {
            workspace: {
              kind: "literal",
              value: {
                type: "workspace",
                workspaceId: current.secondWorkspaceId,
              },
            },
          }),
        ],
      }),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(() => expect(pending.size).toBe(2));
    expect(
      current.execution.run.mock.calls.map(([input]) => input.directory).sort(),
    ).toEqual([
      path.join(current.root, "approved", "one"),
      path.join(current.root, "approved", "two"),
    ]);
    pending.get("A")?.resolve("A");
    pending.get("B")?.resolve("B");
    await waitForPlan(async () =>
      expect((await current.service.run(current.bob.id, run.id)).status).toBe(
        "succeeded",
      ),
    );
  });

  it("marks orphaned runs interrupted without claiming confirmed abort or releasing unknown writing processes", async () => {
    const current = await setup();
    const agentId = await addCliAgent(current);
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, agentId, {
        nodes: ["A", "B"].map((id) => executionStep(id, agentId)),
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const plan = await current.planRepository.find(id);
    if (!plan) throw new Error("Missing fixture");
    const snapshot = await current.preparation.prepare(current.bob.id, plan);
    const run: AgentPlanRun = {
      id: "orphan",
      planId: id,
      planName: plan.name,
      planRevision: 1,
      userId: current.bob.id,
      startedAt: "now",
      status: "running",
      stopRequested: false,
      steps: [
        {
          id: "A",
          name: "Worker",
          status: "running",
          cancellation: "none",
          isBlocked: false,
          output: null,
          error: null,
        },
        {
          id: "B",
          name: "Worker",
          status: "waiting",
          cancellation: "none",
          isBlocked: false,
          output: null,
          error: null,
        },
      ],
    };
    await current.runRepository.create(run, snapshot, [current.workspaceId]);
    await current.service.recoverInterruptedRuns();
    expect(await current.runRepository.find(run.id)).toMatchObject({
      status: "failed",
      stopRequested: true,
      steps: [
        {
          status: "failed",
          cancellation: "requested",
          error: "plan_interrupted",
        },
        { status: "waiting", isBlocked: true },
      ],
    });
    expect(
      await getDatabase().query(
        "SELECT run_id FROM agent_plan_workspace_locks;",
      ),
    ).toEqual([["orphan"]]);
    await expect(
      current.service.play(current.bob.id, id, 1),
    ).rejects.toMatchObject({ code: "plan_workspace_conflict" });
    expect(current.execution.run).not.toHaveBeenCalled();
  });
});
