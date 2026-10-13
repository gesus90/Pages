import { createHash } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import { PageAgentService } from "@/backend/service/agents/PageAgentService";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";

import {
  controlExecution,
  createExecutionPlanHarness,
  executionPlan,
  executionStep,
  waitForPlan,
} from "../helpers/execution-plans";
import { pageAgentInput } from "../helpers/page-agents";
import { useMigratedDatabase } from "../helpers/test-database";

import type { ExecutionPlanHarness } from "../helpers/execution-plans";

/** The worker agent of the harness is bound to its project, so it cannot be the model of a user agent. */
async function addModelSource(current: ExecutionPlanHarness): Promise<void> {
  await current.profileRepository.save({
    id: "model-source",
    name: "Model source",
    connectionId: "connection",
    model: "model-a",
    reasoningEffort: "medium",
    isActive: true,
    purposes: ["agent"],
    targets: [{ kind: "system", targetId: "agent" }],
    configuration: emptyAgentConfiguration("system"),
  });
}

describe("PAGE-20 terminal agent run archive and definition immutability", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });
  async function setup() {
    const database = getDatabase();
    harness = await createExecutionPlanHarness(database);
    const current = harness;
    const pages = new PageAgentService(
      {
        profiles: current.profileRepository,
        connections: current.connections,
        authorization: current.authorization,
        groups: new UserGroupRepository(database),
        operations: new AgentOperationRegistry(),
        workspaces: current.workspaces,
        content: new AgentContentAccess(
          current.projects,
          current.wiki.repository,
        ),
      },
      current.profiles,
      current.files,
    );
    await addModelSource(current);
    const agentId = await pages.save(
      current.bob.id,
      null,
      pageAgentInput({ modelProfileId: "model-source" }),
    );
    return { ...current, pages, userAgentId: agentId };
  }

  it.each(["succeeded", "failed", "cancelled", "timeout"] as const)(
    "archives %s exactly once, with model, timestamps, rendered input and sanitized result",
    async (status) => {
      const current = await setup();
      current.execution.run.mockImplementation(async (input) => {
        await input.beforeStart?.();
        if (status === "failed") throw new AgentError("plan_step_failed");
        if (status === "cancelled") throw new AgentPlanCancelledError();
        if (status === "timeout") throw new TextAssistantError("timeout");
        return "Completed";
      });
      const planId = await current.service.save(
        current.bob.id,
        null,
        executionPlan(current.workspaceId, current.userAgentId),
      );
      const run = await current.service.play(current.bob.id, planId, 1);
      const runId = createHash("sha256").update(`${run.id}\nA`).digest("hex");
      await waitForPlan(async () => {
        const archived = await current.archive.read(
          current.bob.id,
          current.userAgentId,
          runId,
        );
        expect(archived.record).toMatchObject({
          agentId: current.userAgentId,
          runId,
          planRunId: run.id,
          status,
          model: "model-a",
          reasoningEffort: "medium",
          input: "Test Default task\n\nA",
        });
        expect(Number.isFinite(Date.parse(archived.record.startedAt))).toBe(
          true,
        );
        expect(Number.isFinite(Date.parse(archived.record.finishedAt))).toBe(
          true,
        );
      });
      await current.engine.shutdown();
      const directory = path.join(
        current.root,
        "Agents",
        current.userAgentId,
        "runs",
      );
      const before = await readFile(
        path.join(directory, `${runId}.md`),
        "utf8",
      );
      await current.archive.recover();
      await current.archive.recover();
      expect(await readdir(directory)).toEqual([`${runId}.md`]);
      expect(await readFile(path.join(directory, `${runId}.md`), "utf8")).toBe(
        before,
      );
      expect(before).toContain("## Input");
      expect(before).toContain("## Result");
      expect(before).not.toMatch(/ciphertext|connectionId|hasApiKey/u);
      await expect(
        current.archive.read(current.alice.id, current.userAgentId, runId),
      ).rejects.toMatchObject({ code: "agent_usage_denied" });
      await expect(
        current.archive.read(current.bob.id, "../escape", runId),
      ).rejects.toThrow();
    },
  );

  it("holds AGENT.md unchanged while running and denies an owner save until settled", async () => {
    const current = await setup();
    const filename = path.join(
      current.root,
      "Agents",
      current.userAgentId,
      "AGENT.md",
    );
    const before = await readFile(filename, "utf8");
    let finish: (() => void) | undefined;
    const pending = new Promise<string>((resolve) => {
      finish = () => resolve("Completed");
    });
    current.execution.run.mockImplementation(async (input) => {
      await input.beforeStart?.();
      return pending;
    });
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(() => expect(current.execution.run).toHaveBeenCalled());
    const saved = (await current.pages.page(current.bob.id)).agents[0];
    await expect(
      current.pages.save(current.bob.id, current.userAgentId, {
        ...saved,
        name: "During run",
      }),
    ).rejects.toMatchObject({ code: "profile_running" });
    expect(await readFile(filename, "utf8")).toBe(before);
    finish?.();
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "succeeded",
      ),
    );
    await current.engine.shutdown();
    await current.pages.save(current.bob.id, current.userAgentId, {
      ...saved,
      name: "After run",
    });
    expect(await readFile(filename, "utf8")).toContain("After run");
  });

  it("records result-bound rendered inputs and repairs missing files after restart without duplicate records", async () => {
    const current = await setup();
    const credentialShape = ["sk", "x".repeat(20)].join("-");
    current.execution.run.mockImplementation(async (input) => {
      await input.beforeStart?.();
      return `Result ${credentialShape}`;
    });
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId, {
        nodes: [
          executionStep("A", current.userAgentId),
          executionStep("B", current.userAgentId, {
            input: { kind: "result", stepId: "A" },
          }),
        ],
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "succeeded",
      ),
    );
    await current.engine.shutdown();
    const runId = createHash("sha256").update(`${run.id}\nB`).digest("hex");
    const archived = await current.archive.read(
      current.bob.id,
      current.userAgentId,
      runId,
    );
    expect(archived.record.input).toBe("Test Result [redacted]\n\nB");
    expect(archived.markdown).not.toContain(credentialShape);
    const filename = path.join(
      current.root,
      "Agents",
      current.userAgentId,
      "runs",
      `${runId}.md`,
    );
    await rm(filename);
    await current.archive.recover();
    expect(await readFile(filename, "utf8")).toBe(archived.markdown);
    const rows = await getDatabase().query(
      "SELECT COUNT(*) FROM page_agent_run_records;",
    );
    expect(rows[0]?.[0]).toBe(2);
  });
});

describe("PAGE-20 which runs get a record, and what happens when files fail", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    await harness?.dispose();
    harness = undefined;
  });

  async function setup() {
    const database = getDatabase();
    harness = await createExecutionPlanHarness(database);
    const current = harness;
    const pages = new PageAgentService(
      {
        profiles: current.profileRepository,
        connections: current.connections,
        authorization: current.authorization,
        groups: new UserGroupRepository(database),
        operations: new AgentOperationRegistry(),
        workspaces: current.workspaces,
        content: new AgentContentAccess(
          current.projects,
          current.wiki.repository,
        ),
      },
      current.profiles,
      current.files,
    );
    await addModelSource(current);
    const userAgentId = await pages.save(
      current.bob.id,
      null,
      pageAgentInput({ modelProfileId: "model-source" }),
    );
    const runs = path.join(current.root, "Agents", userAgentId, "runs");
    return { ...current, pages, userAgentId, runs };
  }

  function runIdentifier(planRunId: string, stepId: string): string {
    return createHash("sha256").update(`${planRunId}\n${stepId}`).digest("hex");
  }

  it("records the step that failed and no run of the successor it blocked", async () => {
    const current = await setup();
    current.execution.run.mockImplementation(async (input) => {
      await input.beforeStart?.();
      throw new AgentError("plan_step_failed");
    });
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId, {
        nodes: [
          executionStep("A", current.userAgentId),
          executionStep("B", current.userAgentId, {
            input: { kind: "result", stepId: "A" },
          }),
        ],
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe("failed"),
    );
    await current.engine.shutdown();
    const first = runIdentifier(run.id, "A");
    expect(await readdir(current.runs)).toEqual([`${first}.md`]);
    const stored = await current.archive.read(
      current.bob.id,
      current.userAgentId,
      first,
    );
    expect(stored.record).toMatchObject({
      status: "failed",
      result: "plan_step_failed",
    });
    await expect(
      current.archive.read(
        current.bob.id,
        current.userAgentId,
        runIdentifier(run.id, "B"),
      ),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
  });

  it("records a stopped step as cancelled and the step that never started not at all", async () => {
    const current = await setup();
    const pending = controlExecution(current.execution);
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId, {
        nodes: [
          executionStep("A", current.userAgentId),
          executionStep("B", current.userAgentId, {
            input: { kind: "result", stepId: "A" },
          }),
        ],
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    const stopping = current.service.stop(current.bob.id, run.id);
    await waitForPlan(() =>
      expect(pending.get("A")?.signal.aborted).toBe(true),
    );
    pending.get("A")?.reject(new AgentPlanCancelledError());
    await stopping;
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "cancelled",
      ),
    );
    await current.engine.shutdown();
    expect(await readdir(current.runs)).toEqual([
      `${runIdentifier(run.id, "A")}.md`,
    ]);
    const stored = await current.archive.read(
      current.bob.id,
      current.userAgentId,
      runIdentifier(run.id, "A"),
    );
    expect(stored.record.status).toBe("cancelled");
    expect(stored.record.input).toBe("Test Default task\n\nA");
  });

  it("pins the prompt before the model starts and keeps it only until the record carries it", async () => {
    const current = await setup();
    let pinned: unknown = null;
    current.execution.run.mockImplementation(async (input) => {
      await input.beforeStart?.();
      pinned = await getDatabase().query(
        "SELECT prompt FROM page_agent_run_inputs;",
      );
      return "Completed";
    });
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "succeeded",
      ),
    );
    await current.engine.shutdown();
    expect(pinned).toEqual([["Test Default task\n\nA"]]);
    expect(
      await getDatabase().query("SELECT 1 FROM page_agent_run_inputs;"),
    ).toEqual([]);
    expect(
      await getDatabase().query(
        "SELECT plan_run_id FROM page_agent_archived_runs;",
      ),
    ).toEqual([[run.id]]);
    const { record } = await current.archive.read(
      current.bob.id,
      current.userAgentId,
      runIdentifier(run.id, "A"),
    );
    expect(Date.parse(record.startedAt)).toBeLessThanOrEqual(
      Date.parse(record.finishedAt),
    );
  });

  it("never disturbs a plan run when a file cannot be written and repairs it afterwards", async () => {
    const current = await setup();
    const failure = vi.spyOn(console, "error").mockImplementation(() => {});
    // A file where the runs folder belongs makes every write below it fail.
    await writeFile(current.runs, "not a folder");
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "succeeded",
      ),
    );
    await current.engine.shutdown();
    expect(failure).toHaveBeenCalled();
    // The record is stored, so only the file is missing; the run is not marked as done.
    const runId = runIdentifier(run.id, "A");
    expect(
      await getDatabase().query(
        "SELECT status FROM page_agent_run_records WHERE run_id = $run_id;",
        { run_id: runId },
      ),
    ).toEqual([["succeeded"]]);
    expect(
      await getDatabase().query("SELECT 1 FROM page_agent_archived_runs;"),
    ).toEqual([]);
    await rm(current.runs);
    await current.archive.recover();
    expect(await readdir(current.runs)).toEqual([`${runId}.md`]);
    expect(
      await getDatabase().query(
        "SELECT plan_run_id FROM page_agent_archived_runs;",
      ),
    ).toEqual([[run.id]]);
  });

  it("hands out the stored record and puts a replaced file back", async () => {
    const current = await setup();
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "succeeded",
      ),
    );
    await current.engine.shutdown();
    const runId = runIdentifier(run.id, "A");
    const filename = path.join(current.runs, `${runId}.md`);
    const original = await readFile(filename, "utf8");
    await rm(filename);
    await writeFile(filename, "# Replaced by another process\n");
    const read = await current.archive.read(
      current.bob.id,
      current.userAgentId,
      runId,
    );
    expect(read.markdown).toBe(original);
    expect(await readFile(filename, "utf8")).toBe(original);
  });

  it("records the step an interrupted server left running when it starts again", async () => {
    const current = await setup();
    const pending = controlExecution(current.execution);
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId, {
        nodes: [
          executionStep("A", current.userAgentId),
          executionStep("B", current.userAgentId, {
            input: { kind: "result", stepId: "A" },
          }),
        ],
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    // What the next start of the server does with a run it finds unfinished.
    await current.service.recoverInterruptedRuns();
    await current.archive.recover();
    expect(await readdir(current.runs)).toEqual([
      `${runIdentifier(run.id, "A")}.md`,
    ]);
    const { record } = await current.archive.read(
      current.bob.id,
      current.userAgentId,
      runIdentifier(run.id, "A"),
    );
    expect(record).toMatchObject({
      status: "failed",
      result: "plan_interrupted",
      input: "Test Default task\n\nA",
    });
  });
  it("refuses a plan with an agent that is not shared with the planner, whatever the request claims", async () => {
    const current = await setup();
    await expect(
      current.service.save(
        current.alice.id,
        null,
        executionPlan(current.workspaceId, current.userAgentId),
      ),
    ).rejects.toMatchObject({ code: "plan_access_denied" });
    expect(current.execution.run).not.toHaveBeenCalled();
    expect(await readdir(path.join(current.root, "Agents"))).toEqual([
      current.userAgentId,
    ]);
  });

  it("checks the connection scope again when a step starts and records the refusal as a failed run", async () => {
    const current = await setup();
    const pending = controlExecution(current.execution);
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId, {
        nodes: [
          executionStep("A", current.userAgentId),
          executionStep("B", current.userAgentId, {
            input: { kind: "result", stepId: "A" },
          }),
        ],
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(() => expect(pending.has("A")).toBe(true));
    // The administrator narrows the connection while the first step runs.
    await current.connections.scopes().save("connection", {
      mode: "restricted",
      targets: [{ kind: "person", targetId: current.alice.id }],
    });
    pending.get("A")?.resolve("Done");
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe("failed"),
    );
    await current.engine.shutdown();
    expect(pending.has("B")).toBe(false);
    const { record } = await current.archive.read(
      current.bob.id,
      current.userAgentId,
      runIdentifier(run.id, "B"),
    );
    expect(record).toMatchObject({ status: "failed", result: "accessDenied" });
    expect(
      (
        await current.archive.read(
          current.bob.id,
          current.userAgentId,
          runIdentifier(run.id, "A"),
        )
      ).record.status,
    ).toBe("succeeded");
  });
  it("writes the records of ended runs found in the stored history, with what that history knows", async () => {
    const current = await setup();
    const known = {
      step: {
        id: "A",
        agentId: current.userAgentId,
        instruction: "Stored step",
      },
      model: "model-a",
      reasoningEffort: null,
      prepared: { parameters: { markdown: "Stored template" } },
    };
    const view = {
      id: "stored-run",
      planId: "stored-plan",
      planName: "Stored plan",
      planRevision: 1,
      userId: current.bob.id,
      startedAt: "2026-10-01T10:00:00.000Z",
      status: "failed",
      stopRequested: false,
      steps: [
        {
          id: "A",
          name: "Stored step",
          status: "failed",
          cancellation: "none",
          isBlocked: false,
          output: null,
          error: "plan_step_failed",
        },
      ],
    };
    // The snapshot names a second step that the view of the run does not know.
    const snapshot = {
      steps: [known, { ...known, step: { ...known.step, id: "B" } }],
    };
    await getDatabase().execute(
      `
      INSERT INTO agent_plan_runs (
          id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json
      ) VALUES (
          $id, $plan_id, $user_id, 'project', $workspace_id, $started_at, 'failed', $view_json, $snapshot_json
      );
    `,
      {
        id: view.id,
        plan_id: view.planId,
        user_id: current.bob.id,
        workspace_id: current.workspaceId,
        started_at: view.startedAt,
        view_json: JSON.stringify(view),
        snapshot_json: JSON.stringify(snapshot),
      },
    );
    await current.archive.recover();
    const { record } = await current.archive.read(
      current.bob.id,
      current.userAgentId,
      runIdentifier("stored-run", "A"),
    );
    expect(record).toMatchObject({
      status: "failed",
      startedAt: "2026-10-01T10:00:00.000Z",
      input: "Stored template\n\nStored step",
      result: "plan_step_failed",
      reasoningEffort: null,
    });
    expect(await readdir(current.runs)).toEqual([
      `${runIdentifier("stored-run", "A")}.md`,
    ]);
  });
  it("checks workspace and wiki references of the owner when the services for them are wired, and refuses them otherwise", async () => {
    const current = await setup();
    const database = getDatabase();
    const configuration = (
      type: "workspace" | "wiki",
      defaultValue: unknown,
    ) => {
      const proposed = pageAgentInput({ modelProfileId: "model-source" });
      return {
        ...proposed,
        configuration: {
          ...proposed.configuration,
          markdown: type === "wiki" ? "{{ref.markdown}}" : "{{ref.path}}",
          parameters: [
            {
              name: "ref",
              type,
              description: "Reference",
              isRequired: false,
              defaultValue,
            },
          ],
        },
      };
    };
    // Both references of the owner are accepted and stay as saved.
    await current.pages.save(
      current.bob.id,
      null,
      configuration("workspace", {
        type: "workspace",
        workspaceId: current.workspaceId,
      }),
    );
    await current.pages.save(
      current.bob.id,
      null,
      configuration("wiki", { type: "wiki", pageId: current.page.id }),
    );
    await expect(
      current.pages.save(
        current.bob.id,
        null,
        configuration("workspace", { type: "workspace", workspaceId: "gone" }),
      ),
    ).rejects.toThrow();
    // Without the services that resolve them, no reference can be verified.
    const unwired = new PageAgentService(
      {
        profiles: current.profileRepository,
        connections: current.connections,
        authorization: current.authorization,
        groups: new UserGroupRepository(database),
        operations: new AgentOperationRegistry(),
      },
      current.profiles,
      current.files,
    );
    for (const input of [
      configuration("workspace", {
        type: "workspace",
        workspaceId: current.workspaceId,
      }),
      configuration("wiki", { type: "wiki", pageId: current.page.id }),
    ])
      await expect(
        unwired.save(current.bob.id, null, input),
      ).rejects.toMatchObject({ code: "parameter_reference_unavailable" });
    expect((await unwired.page(current.bob.id)).workspaces).toEqual([]);
  });
  it("puts AGENT.md back when a run changed or removed it and lets go", async () => {
    const current = await setup();
    const filename = path.join(
      current.root,
      "Agents",
      current.userAgentId,
      "AGENT.md",
    );
    const original = await readFile(filename, "utf8");
    current.execution.run.mockImplementation(async (input) => {
      await input.beforeStart?.();
      // What a process under the account of the server could still do.
      await rm(filename);
      await writeFile(filename, "# Tampered by a runtime agent\n");
      return "Completed";
    });
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "succeeded",
      ),
    );
    await waitForPlan(async () =>
      expect(await readFile(filename, "utf8")).toBe(original),
    );
  });

  it("leaves plans that only use agents of users out of the ticket assignments of the administration", async () => {
    const current = await setup();
    await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId, {
        nodes: [
          executionStep("A", current.userAgentId, {
            input: { kind: "source", nodeId: "ticket" },
          }),
          { id: "ticket", type: "task", taskId: current.task.id, x: 0, y: 0 },
        ],
      }),
    );
    await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.agentId, {
        name: "Administrator agent",
        nodes: [
          executionStep("A", current.agentId, {
            input: { kind: "source", nodeId: "ticket" },
          }),
          { id: "ticket", type: "task", taskId: current.task.id, x: 0, y: 0 },
        ],
      }),
    );
    expect(
      Object.keys(await current.service.taskAssignments(current.admin)),
    ).toEqual([current.agentId]);
  });
  it("lets the person an agent is shared with run it and read the record, never the owner, and no longer once the share ends", async () => {
    const current = await setup();
    const shared = (await current.pages.page(current.bob.id)).agents[0];
    await current.pages.save(current.bob.id, current.userAgentId, {
      ...shared,
      configuration: {
        ...shared.configuration,
        sharing: { isGlobal: true, targets: [] },
      },
    });
    const planId = await current.service.save(
      current.alice.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId),
    );
    const run = await current.service.play(current.alice.id, planId, 1);
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "succeeded",
      ),
    );
    await current.engine.shutdown();
    const runId = runIdentifier(run.id, "A");
    const own = await current.archive.read(
      current.alice.id,
      current.userAgentId,
      runId,
    );
    expect(own.record).toMatchObject({
      userId: current.alice.id,
      status: "succeeded",
    });
    // The owner of the agent did not run it, so the record is not theirs to read.
    await expect(
      current.archive.read(current.bob.id, current.userAgentId, runId),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
    await expect(
      current.pages.requireVisible(current.alice.id, current.userAgentId),
    ).resolves.toBeUndefined();
    // Once the owner closes the share, the route no longer delivers the record.
    const reopened = (await current.pages.page(current.bob.id)).agents[0];
    await current.pages.save(current.bob.id, current.userAgentId, {
      ...reopened,
      configuration: {
        ...reopened.configuration,
        sharing: { isGlobal: false, targets: [] },
      },
    });
    await expect(
      current.pages.requireVisible(current.alice.id, current.userAgentId),
    ).rejects.toMatchObject({ code: "agent_usage_denied" });
  });
});
