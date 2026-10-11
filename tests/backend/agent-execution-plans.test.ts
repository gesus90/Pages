import { afterEach, describe, expect, it } from "vitest";

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

import {
  createExecutionPlanHarness,
  executionPlan,
  executionStep,
  waitForPlan,
  controlExecution,
} from "../helpers/execution-plans";
import { useMigratedDatabase } from "../helpers/test-database";

describe("A10.4 execution plans, dependency ordering and immutable inputs", () => {
  const getDatabase = useMigratedDatabase();
  let harness:
    Awaited<ReturnType<typeof createExecutionPlanHarness>> | undefined;
  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  it("reopens saved plans, derives project/GitHub and provides tasks and subtasks as separate sources", async () => {
    const current = await createExecutionPlanHarness(getDatabase());
    harness = current;
    await current.projects.upsertIntegration("project", {
      repoUrl: "https://github.com/example/repo",
      repoName: "example/repo",
      tokenHash: "synthetic-hash",
      tokenEncrypted: "synthetic-secret",
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
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId),
    );
    const page = await current.service.page(current.bob.id, {
      planId: id,
      workspaceId: null,
    });
    expect(page.selected).toMatchObject({
      id,
      projectId: "project",
      projectName: "Project project",
      revision: 1,
      github: { repoUrl: "https://github.com/example/repo" },
      canEdit: true,
    });
    expect(page.sources.agents.map((agent) => agent.id)).toContain(
      current.agentId,
    );
    expect(page.sources.tasks.map((task) => task.type).sort()).toEqual([
      "subtask",
      "task",
    ]);
    expect(JSON.stringify(page)).not.toMatch(
      /synthetic-secret|tokenEncrypted|directoryIdentity/,
    );
    expect((await current.planRepository.find(id))?.nodes).toEqual(
      page.selected?.nodes,
    );
  });

  it("starts B only after successful A and forwards explicitly bound sanitized output", async () => {
    const current = await createExecutionPlanHarness(getDatabase());
    harness = current;
    const pending = controlExecution(current.execution);
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: [
          executionStep("A", current.agentId),
          executionStep("B", current.agentId, {
            input: { kind: "result", stepId: "A" },
          }),
        ],
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    expect(pending.has("B")).toBe(false);
    pending.get("A")?.resolve("A result sk-synthetic1234567890");
    await waitForPlan(() => expect(pending.has("B")).toBe(true));
    expect(current.execution.run.mock.calls[1][0].prompt).toContain(
      "A result [redacted]",
    );
    pending.get("B")?.resolve("B result");
    await waitForPlan(async () =>
      expect((await current.service.run(current.bob.id, run.id)).status).toBe(
        "succeeded",
      ),
    );
    const final = await current.service.run(current.bob.id, run.id);
    expect(final.steps.map((step) => step.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
  });

  it("runs B/C independently after A and starts the join D only after both succeed", async () => {
    const current = await createExecutionPlanHarness(getDatabase());
    harness = current;
    const pending = controlExecution(current.execution);
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: ["A", "B", "C", "D"].map((name) =>
          executionStep(name, current.agentId),
        ),
        edges: [
          { from: "A", to: "B" },
          { from: "A", to: "C" },
          { from: "B", to: "D" },
          { from: "C", to: "D" },
        ],
      }),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    pending.get("A")?.resolve("A");
    await waitForPlan(() =>
      expect([...pending.keys()]).toEqual(["A", "B", "C"]),
    );
    pending.get("B")?.resolve("B");
    await waitForPlan(async () =>
      expect(
        (await current.service.run(current.bob.id, run.id)).steps[1].status,
      ).toBe("succeeded"),
    );
    expect(pending.has("D")).toBe(false);
    pending.get("C")?.resolve("C");
    await waitForPlan(() => expect(pending.has("D")).toBe(true));
    pending.get("D")?.resolve("D");
    await waitForPlan(async () =>
      expect((await current.service.run(current.bob.id, run.id)).status).toBe(
        "succeeded",
      ),
    );
  });

  it("blocks all dependents of failure while letting independent branches finish, including later starts", async () => {
    const current = await createExecutionPlanHarness(getDatabase());
    harness = current;
    const pending = controlExecution(current.execution);
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: ["A", "C", "E", "D", "B"].map((name) =>
          executionStep(name, current.agentId),
        ),
        edges: [
          { from: "A", to: "B" },
          { from: "B", to: "D" },
          { from: "C", to: "E" },
        ],
      }),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(() => expect(pending.size).toBe(2));
    pending.get("A")?.reject(new Error("upstream private credentials"));
    pending.get("C")?.resolve("C");
    await waitForPlan(() => expect(pending.has("E")).toBe(true));
    pending.get("E")?.resolve("E");
    await waitForPlan(async () =>
      expect((await current.service.run(current.bob.id, run.id)).status).toBe(
        "failed",
      ),
    );
    const final = await current.service.run(current.bob.id, run.id);
    expect(
      final.steps
        .filter((step) => step.isBlocked)
        .map((step) => step.id)
        .sort(),
    ).toEqual(["B", "D"]);
    expect(final.steps.find((step) => step.id === "E")?.status).toBe(
      "succeeded",
    );
    expect(JSON.stringify(final)).not.toContain("upstream private credentials");
  });

  it("Stop prevents new starts and distinguishes the request from confirmed adapter cancellation", async () => {
    const current = await createExecutionPlanHarness(getDatabase());
    harness = current;
    const pending = controlExecution(current.execution);
    const id = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        nodes: ["A", "B"].map((name) => executionStep(name, current.agentId)),
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    const requested = await current.service.stop(current.bob.id, run.id);
    expect(requested.steps[0]).toMatchObject({
      status: "running",
      cancellation: "requested",
    });
    expect(requested.steps[1]).toMatchObject({
      status: "cancelled",
      cancellation: "not_started",
    });
    expect(pending.get("A")?.signal.aborted).toBe(true);
    pending.get("A")?.reject(new AgentPlanCancelledError());
    await waitForPlan(async () =>
      expect((await current.service.run(current.bob.id, run.id)).status).toBe(
        "cancelled",
      ),
    );
    expect(
      (await current.service.run(current.bob.id, run.id)).steps[0].cancellation,
    ).toBe("confirmed");
    expect(pending.has("B")).toBe(false);
  });

  it("keeps template, task text, wiki content and global parameters frozen after Play", async () => {
    const current = await createExecutionPlanHarness(getDatabase());
    harness = current;
    const pending = controlExecution(current.execution);
    const original = (await current.profileRepository.list()).find(
      (agent) => agent.id === current.agentId,
    );
    if (!original?.configuration) throw new Error("Missing fixture");
    await current.profiles.save(current.admin, current.agentId, {
      ...original,
      configuration: {
        ...original.configuration,
        markdown: "{{input}} / {{branch}} / {{wiki.markdown}}",
        parameters: [
          ...original.configuration.parameters,
          {
            name: "wiki",
            type: "wiki",
            description: "Page",
            isRequired: true,
            defaultValue: { type: "wiki", pageId: current.page.id },
          },
        ],
      },
    });
    const plan = executionPlan(current.workspaceId, current.agentId, {
      globals: { branch: "original-branch" },
      nodes: [
        executionStep("A", current.agentId),
        executionStep("B", current.agentId, {
          input: { kind: "source", nodeId: "task" },
          branch: { kind: "source", nodeId: "variable" },
        }),
        { id: "task", type: "task", taskId: current.task.id, x: 0, y: 0 },
        { id: "variable", type: "variable", name: "branch", x: 0, y: 0 },
      ],
      edges: [{ from: "A", to: "B" }],
    });
    const id = await current.service.save(current.bob.id, null, plan);
    const run = await current.service.play(current.bob.id, id, 1);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    await current.service.save(current.bob.id, id, {
      ...plan,
      revision: 1,
      globals: { branch: "changed-branch" },
    });
    const updated = (await current.profileRepository.list()).find(
      (entry) => entry.id === current.agentId,
    );
    if (!updated?.configuration) throw new Error("Missing fixture");
    await current.profiles.save(current.admin, current.agentId, {
      ...updated,
      configuration: {
        ...updated.configuration,
        markdown: "Changed template {{input}}",
      },
    });
    await current.tasks.updateDescription(current.bob, current.task.id, {
      description: "Changed task",
      baseDescription: current.task.description,
    });
    await current.wiki.service.update(current.alice, current.page.id, {
      title: "Changed",
      content: "Changed wiki",
      icon: null,
      expectedRevision: current.page.revision,
    });
    pending.get("A")?.resolve("A");
    await waitForPlan(() => expect(pending.has("B")).toBe(true));
    const prompt = current.execution.run.mock.calls[1][0].prompt;
    expect(prompt).toContain("Detailed task");
    expect(prompt).toContain("original-branch");
    expect(prompt).toContain("Original page");
    expect(prompt).not.toMatch(
      /Changed task|changed-branch|Changed wiki|Changed template/,
    );
    pending.get("B")?.resolve("B");
    await waitForPlan(async () =>
      expect((await current.service.run(current.bob.id, run.id)).status).toBe(
        "succeeded",
      ),
    );
    expect(
      (await current.service.run(current.bob.id, run.id)).planRevision,
    ).toBe(1);
  });
});
