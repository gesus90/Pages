import { expect, it, vi } from "vitest";

import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";

import { parameterRunFixture } from "./page55-run-fixture";
import { reportedTurn } from "./page333-closeout-fixture";
import {
  progressSession,
  progressStep,
  progressTicket,
} from "./page162-progress-fixture";

import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type {
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type {
  PlanSessionClosed,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

interface IncompleteStepRun {
  readonly result: Partial<AgentPlanStepResult>;
  readonly records: readonly AgentPlanSessionRecord[];
  readonly next: ReturnType<
    typeof vi.fn<(input: AgentPlanExecutionInput) => Promise<PlanSessionTurn>>
  >;
  readonly close: ReturnType<typeof vi.fn<() => Promise<PlanSessionClosed>>>;
}

/** Exercises real node completion and continuation with a stubbed native-session boundary. */
async function runIncompleteStep(
  completeOnReturn: number,
  instruction = "- [ ] Implement feature",
  previousReturns = 0,
  isShared = false,
): Promise<IncompleteStepRun> {
  const fixture = await parameterRunFixture(undefined, "codex_cli");
  const step = {
    ...fixture.step,
    ...(isShared ? { loopId: "loop" } : {}),
    step: { ...fixture.step.step, instruction, completion: "todos" as const },
  };
  const nodes: readonly AgentPlanNode[] = isShared
    ? [
        {
          id: "loop",
          type: "loop",
          name: "Shared iteration",
          x: 0,
          y: 0,
          steps: [step.step],
          edges: [],
          runs: 1,
          runsSource: "value",
          bindings: {},
          countMode: "expected",
          sessionPolicy: "reuse",
          condition: null,
        },
      ]
    : [step.step];
  const snapshot = {
    ...fixture.snapshot,
    steps: [step],
    plan: { ...fixture.snapshot.plan, nodes },
  };
  const records: AgentPlanSessionRecord[] = [];
  let returns = 0;
  const next = vi.fn(
    async (_input: AgentPlanExecutionInput): Promise<PlanSessionTurn> => {
      returns += 1;
      return reportedTurn({
        output:
          "```pages-report\n" +
          JSON.stringify({
            todos: [
              {
                id: "T1",
                status: returns >= completeOnReturn ? "done" : "open",
              },
            ],
            decisions: [],
            summary: "Work",
          }) +
          "\n```",
      });
    },
  );
  const close = vi.fn(async () => ({
    exit: { code: 0, signal: null },
    endedAt: "now",
    leftovers: 0,
    isConfirmed: true,
    containment: "pid_namespace" as const,
  }));
  const runner = new AgentPlanStepRunner({
    start: fixture.start,
    tasks: { checklist: async () => progressTicket() },
    access: { grant: async () => null, revoke: async () => 1 },
    execution: {
      run: async () => "",
      open: async () => ({
        turn: Promise.resolve(
          reportedTurn({
            output:
              '```pages-report\n{"todos":[],"decisions":[],"summary":"I am finished"}\n```',
          }),
        ),
        next,
        close,
      }),
    },
  });
  const run = {
    ...fixture.run,
    steps: [
      progressStep({
        id: step.step.id,
        status: "paused",
        session: { ...progressSession([]), todoReturns: previousReturns },
      }),
    ],
  };
  const result = await runner.run(run, snapshot, step, {
    signal: new AbortController().signal,
    ...(isShared ? { iteration: 1 } : {}),
    save: async (record) => {
      records.push(record);
    },
  });
  if (isShared) await runner.closeGroups(run.id);
  return { result, records, next, close };
}

it("continues the same agent until it finishes its open TODO, without closing between turns", async () => {
  const run = await runIncompleteStep(2);
  expect(run.next).toHaveBeenCalledTimes(2);
  expect(run.next.mock.calls[0]?.[0].prompt).toContain("T1: Implement feature");
  expect(run.next.mock.calls[0]?.[0].resourceContext?.isLocalInstruction).toBe(
    true,
  );
  expect(run.result.status).toBe("succeeded");
  expect(run.records.at(-1)?.acceptance?.todos).toEqual([
    { id: "T1", status: "done" },
  ]);
  expect(run.close).toHaveBeenCalledTimes(1);
});

it("fails after three returns and names every remaining TODO", async () => {
  const run = await runIncompleteStep(99);
  expect(run.next).toHaveBeenCalledTimes(3);
  expect(run.result).toMatchObject({
    status: "failed",
    error: "plan_acceptance_failed",
  });
  expect(run.result.output).toContain(
    "Offene TODOs nach drei Rückgaben:\n- T1: Implement feature",
  );
});

it("accepts the closing report of an assignment without TODOs immediately", async () => {
  const run = await runIncompleteStep(99, "Describe the change");
  expect(run.result.status).toBe("succeeded");
  expect(run.result.session?.contract?.todos).toEqual([]);
  expect(run.next).not.toHaveBeenCalled();
});

it("preserves the three-return budget when the step is resumed", async () => {
  const run = await runIncompleteStep(99, "- [ ] Implement feature", 2);
  expect(run.next).toHaveBeenCalledTimes(1);
  expect(run.result.status).toBe("failed");
  expect(run.records.at(-1)?.todoReturns).toBe(3);
});

it("returns unfinished TODOs within the same retained loop session", async () => {
  const run = await runIncompleteStep(2, "- [ ] Implement feature", 0, true);
  expect(run.next).toHaveBeenCalledTimes(2);
  expect(run.result.status).toBe("succeeded");
  expect(run.result.session?.loop?.iteration).toBe(1);
  expect(run.close).toHaveBeenCalledTimes(1);
});
