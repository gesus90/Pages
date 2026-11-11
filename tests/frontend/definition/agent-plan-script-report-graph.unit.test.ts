import { describe, expect, it } from "vitest";

import { scriptReportGraphIssues } from "@/definition/AgentPlanScriptReportGraph";

import { agent, boundary, edge, planOf, script } from "./plan-fixtures";

import type { AgentPlanBinding } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/** A script whose single text output carries the given policy. */
function policyScript(
  id: string,
  policy: "report" | "gate" | undefined,
  bindings: Record<string, AgentPlanBinding> = {},
): AgentPlanScript {
  return {
    ...script(id, bindings),
    outputs: [{ name: "out", type: "text", ...(policy ? { policy } : {}) }],
  };
}

const RESULT_OF_REPORT: Record<string, AgentPlanBinding> = {
  input: { kind: "result", stepId: "report" },
};

const TARGET = {
  nodeId: "report",
  port: "flow-out",
  reason: "scriptReportTarget",
};
const GATE = { nodeId: "report", port: "flow-out", reason: "scriptReportGate" };

describe("the graph around a report-forwarding script", () => {
  it("finds nothing in a plan without a report script", () => {
    expect(
      scriptReportGraphIssues(
        planOf(
          [
            boundary("start", "start"),
            script("plain"),
            policyScript("gate", "gate"),
            policyScript("free", undefined),
            boundary("end", "end"),
          ],
          [edge("start", "plain"), edge("plain", "end")],
        ),
      ),
    ).toEqual([]);
  });

  it("accepts a report that reaches an agent through a data binding and a gate before End", () => {
    const plan = planOf(
      [
        policyScript("report", "report"),
        agent("review", RESULT_OF_REPORT),
        policyScript("gate", "gate"),
        boundary("end", "end"),
      ],
      [edge("report", "review"), edge("review", "gate"), edge("gate", "end")],
    );

    expect(scriptReportGraphIssues(plan)).toEqual([]);
  });

  it("accepts a report with no connection at all", () => {
    expect(
      scriptReportGraphIssues(planOf([policyScript("report", "report")])),
    ).toEqual([]);
  });

  it("refuses a report that flows into an agent that does not bind its result", () => {
    const plan = planOf(
      [
        policyScript("report", "report"),
        agent("review", {
          other: { kind: "result", stepId: "elsewhere" },
          fixed: { kind: "literal", value: null },
        }),
        policyScript("gate", "gate"),
        boundary("end", "end"),
      ],
      [edge("report", "review"), edge("review", "gate"), edge("gate", "end")],
    );

    expect(scriptReportGraphIssues(plan)).toEqual([TARGET]);
  });
});

describe("the targets of a report-forwarding script", () => {
  it("refuses a flow to a node that cannot take a report: End, a missing node or a plain script", () => {
    const toEnd = planOf(
      [policyScript("report", "report"), boundary("end", "end")],
      [edge("report", "end")],
    );
    const toMissing = planOf(
      [policyScript("report", "report")],
      [edge("report", "nowhere")],
    );
    const toPlain = planOf(
      [
        policyScript("report", "report"),
        policyScript("plain", undefined, RESULT_OF_REPORT),
      ],
      [edge("report", "plain")],
    );

    expect(scriptReportGraphIssues(toEnd)).toEqual([TARGET, GATE]);
    expect(scriptReportGraphIssues(toMissing)).toEqual([TARGET]);
    expect(scriptReportGraphIssues(toPlain)).toEqual([TARGET]);
  });

  it("accepts a following script only when it has a policy and binds the report", () => {
    const withGate = planOf(
      [
        policyScript("report", "report"),
        policyScript("gate", "gate", RESULT_OF_REPORT),
        boundary("end", "end"),
      ],
      [edge("report", "gate"), edge("gate", "end")],
    );
    const unbound = planOf(
      [
        policyScript("report", "report"),
        policyScript("gate", "gate"),
        boundary("end", "end"),
      ],
      [edge("report", "gate"), edge("gate", "end")],
    );

    expect(scriptReportGraphIssues(withGate)).toEqual([]);
    expect(scriptReportGraphIssues(unbound)).toEqual([TARGET]);
  });
});

describe("the gate on the way to End", () => {
  it("refuses a route to End that bypasses the gate even when another route has one", () => {
    const plan = planOf(
      [
        policyScript("report", "report"),
        agent("review", RESULT_OF_REPORT),
        agent("shortcut", RESULT_OF_REPORT),
        policyScript("gate", "gate"),
        boundary("end", "end"),
      ],
      [
        edge("report", "review"),
        edge("report", "shortcut"),
        edge("review", "gate"),
        edge("gate", "end"),
        edge("shortcut", "end"),
      ],
    );

    expect(scriptReportGraphIssues(plan)).toEqual([GATE]);
  });

  it("walks a cycle once and finds End behind it", () => {
    const loops = planOf(
      [
        policyScript("report", "report"),
        agent("a", RESULT_OF_REPORT),
        agent("b"),
      ],
      [edge("report", "a"), edge("a", "b"), edge("b", "a")],
    );
    const leaving = planOf(
      [
        policyScript("report", "report"),
        agent("a", RESULT_OF_REPORT),
        agent("b"),
        boundary("end", "end"),
      ],
      [edge("report", "a"), edge("a", "b"), edge("b", "a"), edge("b", "end")],
    );

    expect(scriptReportGraphIssues(loops)).toEqual([]);
    expect(scriptReportGraphIssues(leaving)).toEqual([GATE]);
  });

  it("reports each report script on its own", () => {
    const plan = planOf(
      [
        policyScript("report", "report"),
        policyScript("second", "report"),
        boundary("end", "end"),
      ],
      [edge("report", "end"), edge("second", "end")],
    );

    expect(
      scriptReportGraphIssues(plan).map(
        (issue) => `${issue.nodeId}:${issue.reason}`,
      ),
    ).toEqual([
      "report:scriptReportTarget",
      "report:scriptReportGate",
      "second:scriptReportTarget",
      "second:scriptReportGate",
    ]);
  });
});
