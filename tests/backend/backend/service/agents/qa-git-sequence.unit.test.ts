import { expect, it, vi } from "vitest";

import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import { GROUP_REPORT, groupEngine, groupTurn } from "./page73-group-fixture";

import type {
  PlanExecution,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

const PAGES_QA_OUTPUT = `{"status":"done","message":"pages"}\n\nSource fingerprint: aaa\n\n${GROUP_REPORT}`;
const MCP_QA_OUTPUT = `{"status":"done","message":"mcp"}\n\nSource fingerprint: bbb\n\n${GROUP_REPORT}`;
const OPEN_REPORT =
  '```pages-report\n{"todos":[{"id":"T1","status":"open"}],"criteria":[{"id":"K1","met":false,"evidence":"lint exit 1"}],"decisions":[],"summary":"open"}\n```';
const BLOCKED_OVER_DONE = `{"status":"blocked","reason":"coverage below 100"}\n\n${GROUP_REPORT}`;
const BLOCKED_OVER_LINES_DONE = `{\n  "status": "blocked"\n}\n\n${GROUP_REPORT}`;

/** Runs the synthetic turns of the sequence and records every prompt the model got. */
function sequence(outputs: readonly string[]): {
  readonly execution: PlanExecution;
  readonly prompts: string[];
} {
  const prompts: string[] = [];
  const turns = [...outputs];
  const turn = (input: { readonly prompt: string }): PlanSessionTurn => {
    prompts.push(input.prompt);
    return groupTurn({ output: turns.shift() ?? "unexpected turn" });
  };
  return {
    prompts,
    execution: {
      run: async () => {
        throw new Error("No API requests");
      },
      open: vi.fn<PlanExecution["open"]>(async (input) => ({
        turn: Promise.resolve(turn(input)),
        next: async (nextInput) => turn(nextInput),
        close: async () => ({
          exit: { code: 0, signal: null },
          endedAt: "2026-10-15T00:00:00Z",
          leftovers: 0,
          isConfirmed: true,
        }),
      })),
    },
  };
}

/** The plan of the QA closeout: Pages QA, then MCP QA, then Git with both results. */
function closeoutPlan(
  world: Awaited<ReturnType<typeof groupEngine>>,
): AgentPlan {
  const [qa, mcp] = world.group.steps;
  const gitConfiguration = {
    ...copyPlanConfiguration(world.source),
    template: {
      ...copyPlanConfiguration(world.source).template,
      markdown: "PAGES:{{qa_result}}\nMCP:{{mcp_result}}",
      parameters: ["qa_result", "mcp_result"].map((name) => ({
        name,
        type: "text" as const,
        description: "",
        isRequired: true,
        defaultValue: null,
      })),
    },
  };
  const group: AgentPlanGroup = {
    ...world.group,
    parameters: [],
    bindings: {},
    steps: [
      { ...qa, id: "qa", bindings: {}, configuration: withoutInput(world) },
      { ...mcp, id: "mcp", bindings: {}, configuration: withoutInput(world) },
      {
        ...qa,
        id: "git",
        configuration: gitConfiguration,
        bindings: {
          qa_result: { kind: "result", stepId: "qa" },
          mcp_result: { kind: "result", stepId: "mcp" },
        },
      },
    ],
    edges: [
      { from: "qa", to: "git", fromPort: "flow-out", toPort: "flow-in" },
      { from: "qa", to: "mcp", fromPort: "flow-out", toPort: "flow-in" },
      { from: "mcp", to: "git", fromPort: "flow-out", toPort: "flow-in" },
    ],
  };
  return {
    ...world.plan,
    nodes: world.plan.nodes
      .filter((node) => node.type !== "parameter")
      .map((node) => (node.id === "group" ? group : node)),
  };
}

function withoutInput(
  world: Awaited<ReturnType<typeof groupEngine>>,
): ReturnType<typeof copyPlanConfiguration> {
  const configuration = copyPlanConfiguration(world.source);
  return {
    ...configuration,
    template: {
      ...configuration.template,
      markdown: "Check everything",
      parameters: [],
    },
  };
}

async function runCloseout(outputs: readonly string[]): Promise<{
  readonly prompts: readonly string[];
  readonly group: { readonly status: string; readonly failedStepId?: string };
  readonly isEndBlocked: boolean;
}> {
  const { execution, prompts } = sequence(outputs);
  const world = await groupEngine(execution);
  const snapshot = await world.preparation.prepare(
    "owner",
    closeoutPlan(world),
  );
  const { id } = await world.engine.start("owner", snapshot);
  await vi.waitFor(() => {
    expect(["succeeded", "failed"]).toContain(world.stored.get(id)?.status);
  });
  const steps = world.stored.get(id)?.steps ?? [];
  const group = steps.find((step) => step.id === "group");
  if (!group) throw new Error("No group step");
  return {
    prompts,
    group: { status: group.status, failedStepId: group.failedStepId },
    isEndBlocked: steps.find((step) => step.id === "end")?.isBlocked === true,
  };
}

it("hands both independent reports unchanged to Git after both QA steps passed", async () => {
  const result = await runCloseout([
    PAGES_QA_OUTPUT,
    MCP_QA_OUTPUT,
    GROUP_REPORT,
  ]);

  expect(result.group.status).toBe("succeeded");
  expect(result.prompts).toHaveLength(3);
  // Git reads fingerprint, status and report of each step itself.
  expect(result.prompts[2]).toContain(`PAGES:${PAGES_QA_OUTPUT}`);
  expect(result.prompts[2]).toContain(`MCP:${MCP_QA_OUTPUT}`);
});

it.each([
  ["an open report", `{"status":"blocked","reason":"x"}\n\n${OPEN_REPORT}`],
  ["a missing report", "Lint failed."],
  ["a blocked status over a complete report", BLOCKED_OVER_DONE],
  ["a blocked object over several lines", BLOCKED_OVER_LINES_DONE],
])(
  "starts neither MCP QA nor Git after Pages QA with %s",
  async (_, output) => {
    const result = await runCloseout([output, MCP_QA_OUTPUT, GROUP_REPORT]);

    expect(result.prompts).toHaveLength(1);
    expect(result.group).toMatchObject({
      status: "failed",
      failedStepId: "qa",
    });
    expect(result.isEndBlocked).toBe(true);
  },
);

// An open report gives its TODOs back to the session three times before the step fails.
it.each([
  ["an open report", OPEN_REPORT, 5],
  ["a blocked status over a complete report", BLOCKED_OVER_DONE, 2],
  ["a blocked object over several lines", BLOCKED_OVER_LINES_DONE, 2],
])("keeps Git from starting after MCP QA with %s", async (_, output, turns) => {
  const answers = Array.from({ length: turns - 1 }, () => output);
  const result = await runCloseout([PAGES_QA_OUTPUT, ...answers, GROUP_REPORT]);

  expect(result.prompts).toHaveLength(turns);
  expect(result.group).toMatchObject({ status: "failed", failedStepId: "mcp" });
  expect(result.isEndBlocked).toBe(true);
});
