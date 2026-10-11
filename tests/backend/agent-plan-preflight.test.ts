import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import { planBindings } from "@/backend/service/agents/AgentPlanBindings";

import {
  createExecutionPlanHarness,
  executionPlan,
  executionStep,
  waitForPlan,
} from "../helpers/execution-plans";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { ExecutionPlanHarness } from "../helpers/execution-plans";

describe("A10 frozen plan inputs and live authorization preflight", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
  });
  async function setup(): Promise<ExecutionPlanHarness> {
    harness = await createExecutionPlanHarness(getDatabase());
    return harness;
  }
  async function fixture(current: ExecutionPlanHarness) {
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId),
    );
    const plan = await current.planRepository.find(id);
    if (!plan) throw new Error("Missing plan fixture");
    const snapshot = await current.preparation.prepare(current.bob.id, plan);
    const run: AgentPlanRun = {
      id: "preflight",
      planId: id,
      planName: plan.name,
      planRevision: plan.revision,
      userId: current.bob.id,
      startedAt: "now",
      status: "running",
      stopRequested: false,
      steps: snapshot.steps.map((entry) => ({
        id: entry.step.id,
        name: entry.name,
        status: "waiting",
        cancellation: "none",
        isBlocked: false,
        output: null,
        error: null,
      })),
    };
    return { plan, snapshot, run, step: snapshot.steps[0] };
  }

  it("rejects empty execution, stale saves and switching a populated plan to another workspace", async () => {
    const current = await setup();
    const { plan } = await fixture(current);
    await expect(
      current.service.save(
        current.bob.id,
        plan.id,
        executionPlan(current.workspaceId, current.agentId),
      ),
    ).rejects.toMatchObject({ code: "plan_conflict" });
    await expect(
      current.service.save(
        current.bob.id,
        plan.id,
        executionPlan(current.secondWorkspaceId, current.agentId, {
          revision: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "plan_context_changed" });
    const empty = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, { nodes: [] }),
    );
    await expect(
      current.service.play(current.bob.id, empty, 1),
    ).rejects.toMatchObject({ code: "plan_invalid" });
    expect(
      (
        await current.service.page(current.bob.id, {
          planId: null,
          workspaceId: null,
        })
      ).sources,
    ).toEqual({ agents: [], tasks: [] });
    await expect(
      current.service.page(current.bob.id, {
        planId: null,
        workspaceId: "lost",
      }),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
  });

  it("rejects missing definitions, redirected workspace context and CLI work without an explicit directory", async () => {
    const current = await setup();
    const { plan } = await fixture(current);
    const resolved = await current.profiles.resolveDefinition(current.bob.id, {
      agentId: current.agentId,
      personalAgentId: null,
      projectId: "project",
    });
    const resolve = vi.spyOn(current.profiles, "resolveDefinition");
    resolve.mockResolvedValueOnce({
      ...resolved,
      profile: { ...resolved.profile, configuration: undefined },
    });
    await expect(
      current.preparation.prepare(current.bob.id, plan),
    ).rejects.toMatchObject({ code: "configuration_invalid" });
    const bound = await current.parameters.prepare(
      current.bob.id,
      {
        agentId: current.agentId,
        personalAgentId: null,
        workspaceId: current.workspaceId,
      },
      {},
    );
    vi.spyOn(current.parameters, "prepare").mockResolvedValueOnce({
      ...bound,
      workspace: { ...bound.workspace, projectId: "redirected" },
    });
    await expect(
      current.preparation.prepare(current.bob.id, plan),
    ).rejects.toMatchObject({ code: "plan_context_changed" });
    resolve.mockResolvedValueOnce({
      ...resolved,
      assignment: {
        ...resolved.assignment,
        connection: {
          ...resolved.assignment.connection,
          provider: "codex_cli",
        },
      },
    });
    await expect(
      current.preparation.prepare(current.bob.id, plan),
    ).rejects.toMatchObject({ code: "plan_directory_required" });
    resolve.mockResolvedValueOnce({
      ...resolved,
      profile: { ...resolved.profile, revision: undefined },
    });
    expect(
      (await current.preparation.prepare(current.bob.id, plan)).steps[0]
        .revision,
    ).toBe(1);
    resolve.mockResolvedValueOnce({
      ...resolved,
      profile: { ...resolved.profile, configuration: undefined },
    });
    await expect(
      current.parameters.prepare(
        current.bob.id,
        {
          agentId: current.agentId,
          personalAgentId: null,
          workspaceId: current.workspaceId,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "configuration_invalid" });
  });

  it("rejects provider, model and effort redirection and changed connection at the final provider boundary", async () => {
    const current = await setup();
    const { run, snapshot, step } = await fixture(current);
    const resolved = await current.profiles.resolveDefinition(current.bob.id, {
      agentId: current.agentId,
      personalAgentId: null,
      projectId: "project",
    });
    const resolve = vi.spyOn(current.profiles, "resolveDefinition");
    for (const assignment of [
      { ...resolved.assignment, model: "other" },
      { ...resolved.assignment, reasoningEffort: "low" },
      {
        ...resolved.assignment,
        connection: {
          ...resolved.assignment.connection,
          provider: "openai" as const,
        },
      },
    ]) {
      resolve.mockResolvedValueOnce({ ...resolved, assignment });
      await expect(
        current.stepStart.prepare(run, snapshot, step),
      ).rejects.toMatchObject({ code: "plan_context_changed" });
    }
    const prepared = await current.stepStart.prepare(run, snapshot, step);
    resolve.mockResolvedValueOnce({
      ...resolved,
      assignment: {
        ...resolved.assignment,
        connection: { ...resolved.assignment.connection, id: "another-access" },
      },
    });
    await expect(prepared.beforeStart?.()).rejects.toMatchObject({
      code: "plan_context_changed",
    });
    expect(current.execution.run).not.toHaveBeenCalled();
  });

  it("requires a completed predecessor result and the frozen workspace/wiki snapshots", async () => {
    const current = await setup();
    const { run, snapshot, step } = await fixture(current);
    const resultStep = {
      ...step,
      step: {
        ...step.step,
        bindings: {
          input: { kind: "result" as const, stepId: "previous" },
        },
      },
    };
    await expect(
      current.stepStart.prepare(run, snapshot, resultStep),
    ).rejects.toMatchObject({ code: "plan_binding_invalid" });
    await expect(
      current.stepStart.prepare(
        {
          ...run,
          steps: [
            ...run.steps,
            {
              ...run.steps[0],
              id: "previous",
              status: "succeeded",
              output: null,
            },
          ],
        },
        snapshot,
        resultStep,
      ),
    ).rejects.toMatchObject({ code: "plan_binding_invalid" });
    for (const type of ["workspace", "wiki"] as const) {
      const template = {
        markdown:
          type === "workspace"
            ? "{{reference.path}}"
            : "{{reference.markdown}}",
        directoryParameter: null,
        parameters: [
          {
            name: "reference",
            type,
            description: "Reference",
            isRequired: true,
            defaultValue: null,
          },
        ],
      };
      const values = {
        reference:
          type === "workspace"
            ? { type, workspaceId: current.workspaceId }
            : { type, pageId: current.page.id },
      };
      const prepared = await current.parameters.prepare(
        current.bob.id,
        {
          agentId: current.agentId,
          personalAgentId: null,
          workspaceId: current.workspaceId,
        },
        values,
        template,
      );
      const corrupted = {
        ...step,
        template,
        prepared: { ...prepared, references: [], wiki: {} },
      };
      await expect(
        current.stepStart.prepare(run, snapshot, corrupted),
      ).rejects.toMatchObject({
        code:
          type === "workspace"
            ? "plan_context_changed"
            : "plan_binding_invalid",
      });
    }
    vi.spyOn(current.parameters, "prepare").mockResolvedValueOnce({
      ...step.prepared,
      workspace: { ...step.prepared.workspace, directoryIdentity: "replaced" },
    });
    await expect(
      current.stepStart.prepare(run, snapshot, step),
    ).rejects.toMatchObject({ code: "plan_context_changed" });
  });

  it("keeps revoked histories private and propagates unexpected storage errors", async () => {
    const current = await setup();
    const { plan } = await fixture(current);
    const run = await current.service.play(current.bob.id, plan.id, 1);
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "succeeded",
      ),
    );
    const read = vi
      .spyOn(current.service, "run")
      .mockRejectedValueOnce(new AgentError("plan_access_denied"));
    expect(
      (
        await current.service.page(current.bob.id, {
          planId: plan.id,
          workspaceId: null,
        })
      ).runs,
    ).toEqual([]);
    read.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(
      current.service.page(current.bob.id, {
        planId: plan.id,
        workspaceId: null,
      }),
    ).rejects.toThrow("storage unavailable");
  });

  it("rejects missing task markdown, undeclared variables and inactive task readers", async () => {
    const current = await setup();
    const { plan, snapshot } = await fixture(current);
    for (const node of [
      { id: "source", type: "task" as const, taskId: "missing", x: 0, y: 0 },
      { id: "source", type: "variable" as const, name: "missing", x: 0, y: 0 },
    ])
      expect(() =>
        planBindings(
          { ...plan, nodes: [node] },
          executionStep("A", current.agentId, {
            input: { kind: "source", nodeId: "source" },
          }),
          [],
        ),
      ).toThrow(expect.objectContaining({ code: "plan_binding_invalid" }));
    const tasks = new AgentPlanTasks(current.tasks, {
      getById: async () => ({ ...current.bob, isActive: false }),
    });
    await expect(tasks.list(current.bob.id, "project")).rejects.toMatchObject({
      code: "plan_access_denied",
    });
    await expect(
      tasks.snapshot(current.bob.id, "project", current.task.id),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    const liveTasks = new AgentPlanTasks(current.tasks, {
      getById: async () => current.bob,
    });
    vi.spyOn(current.tasks, "getById").mockRejectedValueOnce(
      new Error("task unavailable"),
    );
    await expect(
      liveTasks.snapshot(current.bob.id, "project", "missing"),
    ).rejects.toMatchObject({ code: "plan_binding_invalid" });
    const orphan = { ...snapshot, steps: [] };
    const persisted: AgentPlanRun = {
      id: "interrupted",
      planId: plan.id,
      planName: plan.name,
      planRevision: 1,
      userId: current.bob.id,
      startedAt: "now",
      status: "running",
      stopRequested: false,
      steps: [
        {
          id: "finished",
          name: "Finished",
          status: "succeeded",
          isBlocked: false,
          cancellation: "none",
          output: "Saved result",
          error: null,
        },
      ],
    };
    await current.runRepository.create(persisted, orphan, []);
    await current.service.recoverInterruptedRuns();
    expect((await current.runRepository.find(persisted.id))?.steps).toEqual(
      persisted.steps,
    );
  });
});
