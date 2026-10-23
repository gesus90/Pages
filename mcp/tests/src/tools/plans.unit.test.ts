import { describe, expect, it } from "vitest";

import { operationFailure } from "../../../src/tools/operation-failure.ts";
import { PLAN_READ_TOOLS, PLAN_WRITE_TOOLS } from "../../../src/tools/plans.ts";
import { READ_TOOLS } from "../../../src/tools/registry.ts";
import { WRITE_TOOLS } from "../../../src/tools/write-registry.ts";

function rejection(details: unknown): Response {
  return new Response(
    JSON.stringify({
      apiVersion: "1",
      error: { code: "INVALID_REQUEST", details },
    }),
    { status: 400 },
  );
}

function toolOf(name: string): (typeof PLAN_WRITE_TOOLS)[number]["tool"] {
  const entry = [...PLAN_READ_TOOLS, ...PLAN_WRITE_TOOLS].find(
    ({ tool }) => tool.name === name,
  );
  if (!entry) throw new Error(`missing tool ${name}`);
  return entry.tool;
}

describe("plan tools", () => {
  it("registers every plan operation once, reads as reads and writes as writes", () => {
    expect(
      READ_TOOLS.filter(({ operation }) => operation.startsWith("plans.")).map(
        ({ operation }) => operation,
      ),
    ).toEqual([
      "plans.list",
      "plans.read",
      "plans.sources.read",
      "plans.runs.list",
      "plans.run.read",
      "plans.run.reports.read",
      "plans.run.recovery.read",
      "plans.capabilities.read",
      "plans.templates.list",
      "plans.templates.read",
      "plans.control.read",
    ]);
    expect(
      WRITE_TOOLS.filter(({ operation }) => operation.startsWith("plans.")).map(
        ({ operation }) => operation,
      ),
    ).toEqual([
      "plans.create",
      "plans.update",
      "plans.parameter.create",
      "plans.parameter.update",
      "plans.parameter.remove",
      "plans.clone",
      "plans.templates.save",
      "plans.delete",
      "plans.play",
      "plans.pause",
      "plans.resume",
      "plans.stop",
    ]);
  });

  it("require what each call names and leave the rest optional", () => {
    expect(toolOf("read_plan").inputSchema.required).toEqual(["planId"]);
    expect(toolOf("list_plans").inputSchema.required).toBeUndefined();
    expect(toolOf("list_plan_runs").inputSchema.required).toEqual(["planId"]);
    expect(toolOf("create_plan").inputSchema.required).toEqual([
      "operationId",
      "name",
      "workspaceId",
    ]);
    expect(toolOf("update_plan").inputSchema.required).toEqual([
      "operationId",
      "planId",
      "expectedRevision",
    ]);
    expect(toolOf("create_plan_parameter").inputSchema.required).toEqual([
      "operationId",
      "planId",
      "expectedRevision",
      "name",
      "value",
    ]);
    expect(toolOf("remove_plan_parameter").inputSchema.required).toEqual([
      "operationId",
      "planId",
      "expectedRevision",
      "parameterId",
    ]);
  });

  it("marks replacements and removals as destructive", () => {
    const destructive = PLAN_WRITE_TOOLS.filter(
      ({ tool }) => tool.annotations?.destructiveHint,
    ).map(({ tool }) => tool.name);
    expect(destructive).toEqual([
      "update_plan",
      "update_plan_parameter",
      "remove_plan_parameter",
    ]);
  });
});

describe("plan graph refusals", () => {
  it("keeps the findings of a refused graph", async () => {
    const issues = [
      { nodeId: "a", port: "flow-in", problem: "flowIn" },
      { nodeId: null, port: null, problem: "start" },
    ];
    const failure = await operationFailure(
      rejection({ reason: "graph_invalid", issues }),
    );
    expect(failure?.code).toBe("INVALID_REQUEST");
    expect(failure?.details).toEqual({ reason: "graph_invalid", issues });
  });

  it("keeps the reason of a refused graph without findings", async () => {
    const failure = await operationFailure(
      rejection({ reason: "graph_invalid" }),
    );
    expect(failure?.details).toEqual({ reason: "graph_invalid" });
  });

  it.each<{ readonly label: string; readonly issues: unknown }>([
    { label: "a text", issues: "no list" },
    { label: "a null finding", issues: [null] },
    {
      label: "a numeric node",
      issues: [{ nodeId: 3, port: null, problem: "port" }],
    },
    {
      label: "a numeric port",
      issues: [{ nodeId: "a", port: 4, problem: "port" }],
    },
    {
      label: "an unknown problem",
      issues: [{ nodeId: "a", port: null, problem: "secret" }],
    },
    {
      label: "too many findings",
      issues: Array.from({ length: 51 }, () => ({
        nodeId: null,
        port: null,
        problem: "start",
      })),
    },
  ])("keeps only the reason for $label", async ({ issues }) => {
    const failure = await operationFailure(
      rejection({ reason: "graph_invalid", issues }),
    );
    expect(failure?.details).toEqual({ reason: "graph_invalid" });
  });

  it.each([
    "graph_invalid",
    "parameter_value_invalid",
    "workspace_unavailable",
    "element_missing",
    "element_exists",
  ])("passes the plan reason %s on", async (reason) => {
    const failure = await operationFailure(rejection({ reason, issues: [] }));
    expect(failure?.details).toEqual(
      reason === "graph_invalid" ? { reason, issues: [] } : { reason },
    );
  });
});
