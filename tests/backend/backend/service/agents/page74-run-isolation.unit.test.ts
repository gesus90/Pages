import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";

import { PlanDatabase } from "./page61-plan-database";
import { memoryFiles } from "./page-agent-files";
import { templateFixture, templateInput } from "./page74-template-fixture";

import type { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import type { TextExecution } from "@/backend/agents/TextExecution";
import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

vi.mock("node:fs/promises", async () =>
  (await import("./page-agent-files")).memoryFilesModule(),
);

beforeEach(() => memoryFiles.reset());

async function saveDuringRun(
  previous: AgentPlan,
  plan: AgentPlan,
): Promise<AgentPlan | null> {
  const database = new PlanDatabase();
  database.insert(previous);
  for (const node of plan.nodes)
    if (node.type === "agent") database.agents.add(node.agentId);
  database.runs.push({ planId: plan.id, status: "running" });
  const repository = new AgentPlanRepository(database.asDatabase());
  await repository.save(plan, false);
  return repository.find(plan.id);
}

function recordingRunner(
  start: AgentPlanStepStart,
  request: TextExecution["run"],
): AgentPlanStepRunner {
  return new AgentPlanStepRunner({
    start,
    execution: new AgentPlanExecution(
      { run: request },
      { open: vi.fn() },
      new AgentOperationRegistry(),
      { requireUser: async () => {} },
    ),
    tasks: { checklist: vi.fn() },
    access: { grant: vi.fn(), revoke: async () => 0 },
  });
}

it("runs the practical X/M/R → Y/other model example with an active invocation isolated from template and saved-node edits", async () => {
  const { world, agentId, plan, preparation, start } = await templateFixture();
  const first = plan.nodes.find((node) => node.type === "agent");
  if (first?.type !== "agent" || !first.configuration)
    throw new Error("Missing node");
  const edited = {
    ...first,
    configuration: {
      ...first.configuration,
      modelProfileId: "model-b",
      model: "model-model-b",
      reasoningEffort: "high",
      template: { ...first.configuration.template, markdown: "Y {{count}}" },
    },
  };
  const saved = {
    ...plan,
    nodes: plan.nodes.map((node) => (node.id === edited.id ? edited : node)),
  };
  const snapshot = await preparation.prepare("owner", saved);
  const persisted = JSON.stringify(snapshot);
  const run: AgentPlanRun = {
    id: "run",
    planId: plan.id,
    planName: plan.name,
    planRevision: plan.revision,
    userId: "owner",
    startedAt: "2026-10-15",
    status: "running",
    stopRequested: false,
    steps: [],
  };
  let finish: ((output: string) => void) | undefined;
  const request = vi.fn<TextExecution["run"]>(async () => {
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const sessions: AgentPlanSessionRecord[] = [];
  const runner = recordingRunner(start, request);
  const release = await world.files.hold([agentId]);
  const pending = runner.run(run, snapshot, snapshot.steps[0], {
    signal: new AbortController().signal,
    save: async (session) => {
      sessions.push(structuredClone(session));
    },
  });
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(request.mock.calls[0][0]).toMatchObject({
    prompt: "Y 7\n\nAdditional",
    agent: { model: "model-model-b", reasoningEffort: "high" },
  });
  await world.agents.save("owner", agentId, {
    ...templateInput(),
    revision: 1,
    configuration: {
      ...templateInput().configuration,
      markdown: "Z",
      parameters: [],
    },
  });
  const changed = {
    ...edited,
    configuration: {
      ...edited.configuration,
      modelProfileId: "model-a",
      model: "model-model-a",
      reasoningEffort: "low",
      template: { ...edited.configuration.template, markdown: "Saved later" },
    },
  };
  const laterPlan = {
    ...saved,
    nodes: saved.nodes.map((node) => (node.id === changed.id ? changed : node)),
  };
  const storedLater = await saveDuringRun(saved, laterPlan);
  expect(storedLater?.nodes).not.toEqual(snapshot.plan.nodes);
  expect(JSON.stringify(snapshot)).toBe(persisted);
  expect(snapshot.steps[0]).toMatchObject({
    model: "model-model-b",
    reasoningEffort: "high",
    template: { markdown: "Y {{count}}", parameters: [{ name: "count" }] },
  });
  const preparedAgain = await start.prepare(run, snapshot, snapshot.steps[0]);
  await preparedAgain.input.beforeStart?.();
  expect(preparedAgain.input.prompt).toBe("Y 7\n\nAdditional");
  finish?.("Completed with snapshot");
  expect(await pending).toMatchObject({
    status: "succeeded",
    output: "Completed with snapshot",
  });
  expect(sessions.at(-1)?.requested).toMatchObject({
    model: "model-model-b",
    reasoningEffort: "high",
  });
  expect((await world.files.read(agentId)).configuration.markdown).toBe("Z");
  await release();
});

it("rechecks revoked model access immediately before the provider request", async () => {
  const { world, plan, preparation, start } = await templateFixture();
  const snapshot = await preparation.prepare("owner", plan);
  const run: AgentPlanRun = {
    id: "run",
    planId: plan.id,
    planName: plan.name,
    planRevision: 1,
    userId: "owner",
    startedAt: "2026-10-15",
    status: "running",
    stopRequested: false,
    steps: [],
  };
  const prepared = await start.prepare(run, snapshot, snapshot.steps[0]);
  await world.agents.save("owner", snapshot.steps[0].step.agentId, {
    ...templateInput(),
    modelProfileId: "model-b",
    reasoningEffort: "high",
    revision: 1,
  });
  await prepared.input.beforeStart?.();
  expect(prepared.input.agent.model).toBe("model-model-a");
  world.withdrawModel("model-a");
  await expect(prepared.input.beforeStart?.()).rejects.toMatchObject({
    code: "agent_usage_denied",
  });
});
