import { expect, it, vi } from "vitest";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { remotePlanContract } from "@/backend/service/agents/AgentPlanRemoteCommand";
import { settleRemoteAcceptance } from "@/backend/service/agents/AgentPlanRemoteAcceptance";
import { applyRunnerPlanEvent } from "@/backend/service/runner/RunnerPlanEvents";
import { runnerPlanCheckpoint } from "@/backend/service/runner/RunnerPlanCheckpoint";
import { progressTicket } from "./page162-progress-fixture";
import {
  controlledRemoteService,
  progressStore,
  remoteCompletion,
} from "./page171-remote-acceptance-fixture";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";

vi.mock(
  "@/backend/database/repositories/agent/AgentPlanCheckpointRepository",
  () => ({
    AgentPlanCheckpointRepository: class {
      public append = vi.fn(async () => undefined);
    },
  }),
);

it("keeps remote OpenCode provisional until Pages verifies its pinned report", async () => {
  const world = await remoteCompletion(false, "opencode");
  if (!world.event.result) throw new Error("Expected a completion event");
  const output =
    '```pages-report\n{"todos":[],"decisions":[],"summary":"done"}\n```';
  const event = { ...world.event, result: { ...world.event.result, output } };
  const provisional = applyRunnerPlanEvent(
    { ...world, event },
    world.run,
    world.snapshot,
  );
  const current = provisional.run.steps[0];
  const remote = world.snapshot.remoteSteps?.[0];
  if (!current?.session || !remote)
    throw new Error("Expected a remote session");
  expect(current).toMatchObject({
    status: "running",
    remote: { closeout: "confirmed" },
    session: { resultCode: null },
  });
  expect(provisional.checkpoint).toBeUndefined();
  const settled = await settleRemoteAcceptance({
    remote,
    run: provisional.run,
    result: { ...current, status: "succeeded" },
    tasks: {
      checklist: async () => {
        throw new Error("No ticket was bound");
      },
    },
    projectId: async () => "project",
  });
  expect(settled).toMatchObject({
    status: "succeeded",
    error: null,
    output,
    session: { resultCode: 0, acceptance: { verdict: "accepted" } },
  });
  const finished = { ...current, ...settled };
  const run = { ...provisional.run, steps: [finished] };
  const store = progressStore(provisional.run, world.snapshot);
  await store.repository.update(
    run,
    runnerPlanCheckpoint(run, world.snapshot, finished),
  );
  const parameters = store.execute.mock.calls[0]?.[1];
  if (typeof parameters?.view_json !== "string")
    throw new Error("Expected a persisted run");
  expect(readPlanRun(JSON.parse(parameters.view_json)).steps[0]).toMatchObject({
    status: "succeeded",
    output,
    session: { acceptance: { verdict: "accepted" } },
  });
});

it.each([
  [
    '```pages-report\n{"todos":[],"summary":"done"}\n```',
    "succeeded",
    "accepted",
  ],
  ["No structured report", "failed", "open"],
] as const)(
  "dispatches a controlled remote OpenCode outcome through real report evaluation",
  async (output, status, verdict) => {
    const world = await remoteCompletion(false, "opencode");
    const remote = world.snapshot.remoteSteps?.[0];
    if (!remote) throw new Error("Expected a remote command");
    const controlled = controlledRemoteService(world, output);
    const result = await controlled.service.run(
      world.run,
      remote,
      new AbortController().signal,
    );
    expect(controlled.current().steps[0]).toMatchObject({
      status: "running",
      remote: { status: "completed" },
    });
    expect(result).toMatchObject({
      status,
      output,
      session: { acceptance: { verdict } },
    });
  },
);

it("fails the producing OpenCode node on a missing report while retaining the output and closeout", async () => {
  const world = await remoteCompletion(false, "opencode");
  const provisional = applyRunnerPlanEvent(world, world.run, world.snapshot);
  const current = provisional.run.steps[0];
  const remote = world.snapshot.remoteSteps?.[0];
  if (!current?.session || !remote)
    throw new Error("Expected a remote session");
  const settled = await settleRemoteAcceptance({
    remote,
    run: provisional.run,
    result: { ...current, status: "succeeded" },
    tasks: {
      checklist: async () => {
        throw new Error("No ticket was bound");
      },
    },
    projectId: async () => "project",
  });
  expect(settled).toMatchObject({
    status: "failed",
    error: "opencode_acceptance_failed",
    output: current.output,
    remote: { closeout: "confirmed" },
    session: {
      resultCode: -1,
      acceptance: { verdict: "open", issues: ["report_missing"] },
    },
  });
  const store = progressStore(provisional.run, world.snapshot);
  await store.repository.update({
    ...provisional.run,
    steps: [{ ...current, ...settled }],
  });
  const parameters = store.execute.mock.calls[0]?.[1];
  if (typeof parameters?.view_json !== "string")
    throw new Error("Expected a persisted run");
  expect(readPlanRun(JSON.parse(parameters.view_json)).steps[0]).toMatchObject({
    status: "failed",
    error: "opencode_acceptance_failed",
    output: current.output,
  });
});

it("fails closed if the pinned OpenCode contract or live engine is missing", async () => {
  const world = await remoteCompletion(false, "opencode");
  const remote = world.snapshot.remoteSteps?.[0];
  if (!remote) throw new Error("Expected a remote command");
  const oldSnapshot = {
    ...world.snapshot,
    remoteSteps: [{ ...remote, acceptanceContract: undefined }],
  };
  for (const [result, error] of [
    [
      applyRunnerPlanEvent(world, world.run, oldSnapshot),
      "opencode_acceptance_contract_unavailable",
    ],
    [
      applyRunnerPlanEvent(
        { ...world, isDetached: true },
        world.run,
        world.snapshot,
      ),
      "opencode_acceptance_interrupted",
    ],
  ] as const) {
    expect(result.run.steps[0]).toMatchObject({
      status: "failed",
      error,
    });
    expect(result.checkpoint).toBeUndefined();
  }
});

it("rechecks ticket requirements and current access before accepting remote OpenCode", async () => {
  const world = await remoteCompletion(false, "opencode");
  const provisional = applyRunnerPlanEvent(world, world.run, world.snapshot);
  const current = provisional.run.steps[0];
  const remote = world.snapshot.remoteSteps?.[0];
  if (!current?.session || !remote || remote.step.type !== "agent")
    throw new Error("Expected a remote session");
  const ticket = progressTicket("- [ ] Inspect the original work");
  const contract = remotePlanContract(remote.step, [ticket]);
  const pinned = { ...remote, acceptanceContract: contract };
  const result = {
    ...current,
    status: "succeeded" as const,
    output:
      '```pages-report\n{"todos":[{"id":"T1","status":"done"}],"summary":"inspected"}\n```',
    session: { ...current.session, contract },
  };
  const assess = (
    checklist: () => Promise<typeof ticket>,
  ): Promise<Partial<AgentPlanStepResult>> =>
    settleRemoteAcceptance({
      remote: pinned,
      run: provisional.run,
      result,
      tasks: { checklist },
      projectId: async () => "project",
    });
  await expect(assess(async () => ticket)).resolves.toMatchObject({
    status: "succeeded",
    session: { acceptance: { verdict: "accepted" } },
  });
  const changed = await assess(async () =>
    progressTicket("- [ ] Inspect changed work"),
  );
  expect(changed).toMatchObject({
    status: "failed",
    error: "opencode_acceptance_failed",
  });
  expect(changed.session?.acceptance?.issues).toContain(
    "ticket_changed:SYN-ticket",
  );
  const denied = await assess(async () => {
    throw new Error("Synthetic permission denied");
  });
  expect(denied).toMatchObject({
    status: "failed",
    error: "opencode_acceptance_unavailable",
    session: { acceptance: null },
  });
  const store = progressStore(provisional.run, world.snapshot);
  await store.repository.update({
    ...provisional.run,
    steps: [{ ...current, ...denied }],
  });
  const parameters = store.execute.mock.calls[0]?.[1];
  if (typeof parameters?.view_json !== "string")
    throw new Error("Expected a persisted run");
  expect(readPlanRun(JSON.parse(parameters.view_json)).steps[0]).toMatchObject({
    status: "failed",
    error: "opencode_acceptance_unavailable",
    session: { acceptance: null },
  });
});
