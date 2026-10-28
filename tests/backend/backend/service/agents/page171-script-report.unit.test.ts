import { expect, it } from "vitest";

import { assessPlanScriptResult } from "@/backend/service/agents/AgentPlanScriptResult";
import { readPlanNode } from "@/backend/agents/AgentPlanInput";
import { scriptReportGraphIssues } from "@/definition/AgentPlanScriptReportGraph";

import type {
  AgentPlanInput,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

function script(policy?: "report" | "gate"): AgentPlanScript {
  return {
    id: "review",
    type: "script",
    name: "Review",
    x: 0,
    y: 0,
    interpreterProfileId: "python",
    content: "print('result')",
    inputs: [],
    outputs: [{ name: "report", type: "text", ...(policy ? { policy } : {}) }],
    timeoutSeconds: 60,
    bindings: {},
  };
}

function result(output: string): Partial<AgentPlanStepResult> {
  return {
    status: "succeeded",
    output,
    error: null,
    remote: {
      jobId: "job",
      sessionId: "session",
      status: "completed",
      startedAt: null,
      endedAt: null,
      closeout: "confirmed",
    },
  };
}

function report(status: "passed" | "failed" | "partial"): string {
  return JSON.stringify({
    status,
    summary: `Synthetic ${status} check`,
    checks: [{ name: "unit", status, detail: "Observed synthetic result" }],
  });
}

it("persists explicit report policies and rejects unknown policies without changing ordinary output", () => {
  expect(readPlanNode(script("report"))).toMatchObject({
    outputs: [{ policy: "report" }],
  });
  expect(readPlanNode(script("gate"))).toMatchObject({
    outputs: [{ policy: "gate" }],
  });
  expect(readPlanNode(script())).toMatchObject({
    outputs: [{ name: "report", type: "text" }],
  });
  expect(() =>
    readPlanNode({
      ...script(),
      outputs: [{ name: "report", type: "text", policy: "unknown" }],
    }),
  ).toThrow();
});

it("keeps arbitrary text and empty stdout valid when no report policy was chosen", () => {
  for (const output of ["", "ordinary text", "{not JSON}"])
    expect(assessPlanScriptResult(script(), result(output))).toEqual(
      result(output),
    );
});

it.each(["passed", "failed", "partial"] as const)(
  "forwards a complete %s report with its exact output and a separate assessment",
  (status) => {
    const output = report(status);
    expect(
      assessPlanScriptResult(script("report"), result(output)),
    ).toMatchObject({
      status: "succeeded",
      output,
      report: {
        status,
        checkCount: 1,
        failedCount: status === "failed" ? 1 : 0,
        partialCount: status === "partial" ? 1 : 0,
      },
    });
  },
);

it.each(["failed", "partial"] as const)(
  "blocks a strict gate on a complete %s report without discarding it",
  (status) => {
    const output = report(status);
    expect(
      assessPlanScriptResult(script("gate"), result(output)),
    ).toMatchObject({
      status: "failed",
      error: "plan_script_review_failed",
      output,
      report: { status },
      remote: { closeout: "confirmed" },
    });
  },
);

it("allows a gate only when every declared check passed", () => {
  expect(
    assessPlanScriptResult(script("gate"), result(report("passed"))),
  ).toMatchObject({
    status: "succeeded",
    report: { status: "passed", checkCount: 1 },
  });
});

it.each([
  "",
  "not JSON",
  JSON.stringify({ status: "passed", summary: "No checks", checks: [] }),
  JSON.stringify({
    status: "passed",
    summary: "Contradiction",
    checks: [{ name: "test", status: "failed", detail: "exit 1" }],
  }),
  JSON.stringify({
    status: "failed",
    summary: "Duplicate",
    checks: [
      { name: "test", status: "failed", detail: "exit 1" },
      { name: "test", status: "passed", detail: "exit 0" },
    ],
  }),
])(
  "rejects missing, invalid or contradictory declared reports at the source",
  (output) => {
    expect(
      assessPlanScriptResult(script("report"), result(output)),
    ).toMatchObject({
      status: "failed",
      error: "plan_script_result_invalid",
      output,
    });
    expect(
      assessPlanScriptResult(script("report"), result(output)).report,
    ).toBeUndefined();
  },
);

it("does not turn a nonzero process or unconfirmed closeout into a report success", () => {
  const failed = {
    ...result(report("failed")),
    status: "failed" as const,
    error: "plan_script_exit",
  };
  expect(assessPlanScriptResult(script("report"), failed)).toEqual(failed);
  expect(
    assessPlanScriptResult(script("report"), {
      ...result(report("passed")),
      remote: undefined,
    }),
  ).toMatchObject({
    status: "failed",
    error: "plan_script_cleanup",
  });
});

it("refuses credential-shaped output at the source instead of forwarding altered data", () => {
  const sensitive = ["password", "=", "synthetic-value"].join("");
  const output = JSON.stringify({
    status: "failed",
    summary: "Synthetic failure",
    checks: [{ name: "test", status: "failed", detail: sensitive }],
  });
  for (const policy of [undefined, "report"] as const)
    expect(
      assessPlanScriptResult(script(policy), result(output)),
    ).toMatchObject({
      status: "failed",
      error: "plan_script_result_sensitive",
      output,
    });
});

function workflow(): AgentPlanInput {
  const review = script("report");
  const gate = { ...script("gate"), id: "gate", name: "Recheck" };
  const agent = {
    id: "fix",
    type: "agent" as const,
    agentId: "",
    personalAgentId: null,
    instruction: "Fix findings",
    x: 0,
    y: 0,
    bindings: { findings: { kind: "result" as const, stepId: review.id } },
  };
  const nodes = [
    { id: "start", type: "start" as const, x: 0, y: 0 },
    review,
    agent,
    gate,
    { id: "end", type: "end" as const, x: 0, y: 0 },
  ];
  const edges = [
    ["start", "review"],
    ["review", "fix"],
    ["fix", "gate"],
    ["gate", "end"],
  ].map(([from, to]) => ({
    from,
    to,
    fromPort: "flow-out",
    toPort: "flow-in",
  }));
  return {
    name: "Synthetic",
    workspaceId: "workspace",
    usage: "private",
    nodes,
    edges,
    globals: {},
  };
}

it("requires an explicitly bound repair destination and a gate on every route to the end", () => {
  const plan = workflow();
  expect(scriptReportGraphIssues(plan)).toEqual([]);
  const bypass = {
    ...plan,
    edges: [
      ...plan.edges,
      { from: "fix", to: "end", fromPort: "flow-out", toPort: "flow-in" },
    ],
  };
  expect(scriptReportGraphIssues(bypass)).toContainEqual({
    nodeId: "review",
    port: "flow-out",
    reason: "scriptReportGate",
  });
  const unbound = {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.id === "fix" && node.type === "agent"
        ? { ...node, bindings: {} }
        : node,
    ),
  };
  expect(scriptReportGraphIssues(unbound)).toContainEqual({
    nodeId: "review",
    port: "flow-out",
    reason: "scriptReportTarget",
  });
});
