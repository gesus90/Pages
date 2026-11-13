import { describe, expect, it } from "vitest";

import {
  isPlanSwarmDirectory,
  newPlanSwarm,
  planSwarmIssues,
  planSwarmSaveIssue,
  planSwarmWorkerLabel,
  planSwarmWorkerList,
} from "@/definition/AgentPlanSwarm";
import {
  normalizePlanSwarmPath,
  planSwarmScopeOverlaps,
  readPlanSwarmScope,
} from "@/definition/AgentPlanSwarmScope";
import {
  agentSwarmWorkerStep,
  isAgentSwarmOperation,
  readAgentSwarmStep,
} from "@/definition/AgentPlanSwarmOperations";
import { planSwarmGraphIssues } from "@/definition/AgentPlanSwarmGraph";
import { planSwarmTaskCounts } from "@/definition/AgentPlanSwarmRun";
import { planEdgeEndpointIssues } from "@/definition/AgentPlanBranchingGraph";
import { isPlanFlowNode } from "@/definition/AgentPlanGraph";

import type { AgentPlanSwarm } from "@/definition/AgentPlanSwarm";

const MODEL = {
  connectionId: "c1",
  provider: "codex_cli" as const,
  model: "gpt",
  reasoningEffort: null,
};

function ready(changes: Partial<AgentPlanSwarm> = {}): AgentPlanSwarm {
  const swarm = newPlanSwarm({ id: "s", x: 0, y: 0 });
  return {
    ...swarm,
    task: { source: "text", text: "Analyse documents" },
    main: { model: MODEL, access: "read_only" },
    workers: {
      ...swarm.workers,
      same: { model: MODEL, access: "workspace_write" },
    },
    ...changes,
  };
}

describe("swarm node definition", () => {
  it("is complete with task, main model and the same model for every helper", () => {
    expect(planSwarmIssues(ready(), {})).toEqual([]);
    expect(isPlanFlowNode(ready())).toBe(true);
  });

  it("lists missing task and models but saves them as a draft", () => {
    const draft = newPlanSwarm({ id: "s", x: 0, y: 0 });
    expect(planSwarmIssues(draft, {})).toEqual([
      "swarm_task_missing",
      "swarm_main_model_missing",
      "swarm_worker_model_missing",
    ]);
    expect(planSwarmSaveIssue(draft, {})).toBeNull();
    expect(
      planSwarmGraphIssues(draft, {}).map((issue) => issue.reason),
    ).toEqual(["swarmIncomplete"]);
  });

  it("refuses 0 or 11 helpers, a bad time limit and a directory outside the workspace", () => {
    const swarm = ready();
    expect(
      planSwarmSaveIssue(
        ready({ workers: { ...swarm.workers, count: 0 } }),
        {},
      ),
    ).toBe("swarm_worker_count_invalid");
    expect(
      planSwarmSaveIssue(
        ready({ workers: { ...swarm.workers, count: 11 } }),
        {},
      ),
    ).toBe("swarm_worker_count_invalid");
    expect(planSwarmSaveIssue(ready({ timeoutMinutes: 0 }), {})).toBe(
      "swarm_timeout_invalid",
    );
    expect(planSwarmSaveIssue(ready({ directory: "../x" }), {})).toBe(
      "swarm_directory_invalid",
    );
    expect(isPlanSwarmDirectory("docs/a")).toBe(true);
    expect(isPlanSwarmDirectory("/etc")).toBe(false);
  });

  it("refuses a remote target of its own or inherited from the plan", () => {
    const remote = { kind: "remote" as const, workspaceId: "w" };
    expect(planSwarmSaveIssue(ready({ executionTarget: remote }), {})).toBe(
      "swarm_remote_unsupported",
    );
    expect(planSwarmSaveIssue(ready(), { executionTarget: remote })).toBe(
      "swarm_remote_unsupported",
    );
    expect(
      planSwarmSaveIssue(ready({ executionTarget: { kind: "local" } }), {
        executionTarget: remote,
      }),
    ).toBeNull();
    expect(
      planSwarmGraphIssues(ready({ executionTarget: remote }), {})[0]?.reason,
    ).toBe("swarmRemoteUnsupported");
  });

  it("uses one configuration for all helpers or one per helper", () => {
    const swarm = ready();
    const other = {
      model: { ...MODEL, model: "deepseek" },
      access: "read_only" as const,
    };
    const individual = ready({
      workers: {
        ...swarm.workers,
        count: 3,
        mode: "individual",
        individual: [other],
      },
    });
    expect(
      planSwarmWorkerList(individual.workers).map(
        (worker) => worker.model?.model,
      ),
    ).toEqual(["deepseek", "gpt", "gpt"]);
    expect(planSwarmWorkerLabel(9)).toBe("H10");
  });
});

describe("swarm areas", () => {
  it("normalizes paths and refuses escapes", () => {
    expect(normalizePlanSwarmPath("./docs//a/")).toBe("docs/a");
    expect(normalizePlanSwarmPath("../a")).toBeNull();
    expect(normalizePlanSwarmPath("/a")).toBeNull();
    expect(readPlanSwarmScope(["a", "./a", "b"])).toEqual(["a", "b"]);
  });

  it("finds overlaps of nested and equal areas, not of neighbours", () => {
    const taken = [{ owner: "T1", scope: ["docs/mails"] }];
    expect(planSwarmScopeOverlaps(["docs"], taken)).toHaveLength(1);
    expect(planSwarmScopeOverlaps(["docs/mails/x.txt"], taken)).toHaveLength(1);
    expect(planSwarmScopeOverlaps(["docs/mailsbox"], taken)).toHaveLength(0);
    expect(planSwarmScopeOverlaps([""], taken)).toHaveLength(1);
  });
});

describe("swarm operations and graph", () => {
  it("names helper steps and swarm operations", () => {
    expect(readAgentSwarmStep(agentSwarmWorkerStep("n1", "H2"))).toEqual({
      nodeId: "n1",
      workerId: "H2",
    });
    expect(readAgentSwarmStep("n1")).toEqual({ nodeId: "n1", workerId: null });
    expect(isAgentSwarmOperation("run.swarm.lock")).toBe(true);
    expect(isAgentSwarmOperation("ticket.read")).toBe(false);
  });

  it("connects a swarm into the flow like an agent", () => {
    const plan = {
      name: "p",
      workspaceId: "w",
      usage: "private" as const,
      globals: {},
      nodes: [{ id: "a", type: "start" as const, x: 0, y: 0 }, ready()],
      edges: [],
    };
    expect(
      planEdgeEndpointIssues(plan, {
        from: "a",
        to: "s",
        fromPort: "flow-out",
        toPort: "flow-in",
      }),
    ).toEqual([]);
  });

  it("counts finished and handed-out subtasks", () => {
    const task = {
      id: "T1",
      workerId: null,
      requestedWorkerId: null,
      instruction: "",
      scope: [],
      attempts: 1,
      result: null,
      error: null,
      startedAt: null,
      endedAt: null,
    };
    expect(
      planSwarmTaskCounts({
        tasks: [
          { ...task, status: "done" },
          { ...task, status: "running" },
          { ...task, status: "cancelled" },
        ],
      }),
    ).toEqual({ finished: 1, assigned: 2 });
  });
});
