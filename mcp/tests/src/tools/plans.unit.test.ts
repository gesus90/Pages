import { describe, expect, it } from "vitest";

import { operationFailure } from "../../../src/tools/operation-failure.ts";
import { PLAN_WRITE_TOOLS } from "../../../src/tools/plans.ts";
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
  const entry = [...READ_TOOLS, ...WRITE_TOOLS].find(
    ({ tool }) => tool.name === name,
  );
  if (!entry) throw new Error(`missing tool ${name}`);
  return entry.tool;
}

describe("plan refusal history", () => {
  it("adds scoped history paging to the existing read-only control tool", () => {
    const tool = toolOf("read_plan_control");
    expect(tool.inputSchema.required).toEqual(["planId"]);
    expect(tool.inputSchema.properties?.includeStartRejections).toEqual({
      type: "boolean",
      const: true,
    });
    expect(tool.inputSchema.properties?.beforeRejectionId).toMatchObject({
      type: "string",
      minLength: 1,
    });
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.description).toContain("nextBefore");
    expect(tool.description).toContain(
      "run-scoped credentials cannot read history",
    );
  });
});

describe("plan session event reads", () => {
  it("requires the complete attempt key and bounded sequence pagination", () => {
    const tool = toolOf("read_plan_run_session_events");
    expect(tool.inputSchema.required).toEqual([
      "planId",
      "runId",
      "stepId",
      "attemptId",
    ]);
    expect(tool.inputSchema.properties?.limit).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 32,
    });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(tool.description).toContain("retainedFrom");
    expect(tool.description).toContain("legacy record fallback");
    expect(tool.description).toContain(
      "Current executor and snapshot resource rights",
    );
  });
});

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
      "plans.run.session.events.read",
      "plans.run.recovery.read",
      "plans.run.diagnostics.read",
      "plans.run.checkpoint.read",
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
      "plans.run.recovery.release",
      "plans.run.recovery.restart",
      "plans.run.recovery.resume",
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
    expect(toolOf("restart_plan_run").inputSchema.required).toEqual([
      "operationId",
      "planId",
      "runId",
      "expectedRecoveryRevision",
      "expectedPlanRevision",
      "confirmRepeat",
    ]);
    expect(toolOf("continue_plan_run").inputSchema.required).toEqual([
      "operationId",
      "planId",
      "runId",
      "expectedRecoveryRevision",
      "expectedPlanRevision",
      "mode",
      "reviewedStepIds",
    ]);
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

it("requires the plan, run and node of a diagnostic", () => {
  expect(toolOf("read_plan_run_diagnostics").inputSchema.required).toEqual([
    "planId",
    "runId",
    "stepId",
  ]);
});

it("offers the same optional default execution target on plan creation and update", () => {
  for (const name of ["create_plan", "update_plan"]) {
    const schema = toolOf(name).inputSchema;
    expect(schema.required).not.toContain("executionTarget");
    expect(schema.properties?.executionTarget).toMatchObject({
      oneOf: [
        { properties: { kind: { const: "local" } }, required: ["kind"] },
        {
          properties: {
            kind: { const: "remote" },
            workspaceId: { type: "string", minLength: 1, maxLength: 100 },
          },
          required: ["kind", "workspaceId"],
        },
      ],
    });
  }
});

it("requires the plan and run of a checkpoint, with optional version and chunk fields", () => {
  const tool = toolOf("read_plan_run_checkpoint");
  expect(tool.inputSchema.required).toEqual(["planId", "runId"]);
  expect(tool.inputSchema.properties).toHaveProperty("version");
  expect(tool.inputSchema.properties).toHaveProperty("cursor");
  expect(tool.inputSchema.properties).toHaveProperty("maxBytes");
});

describe("plan graph refusals", () => {
  it.each(["scriptReportTarget", "scriptReportGate"] as const)(
    "retains the explicit report-policy finding %s",
    async (problem) => {
      const issues = [{ nodeId: "review", port: "flow-out", problem }];
      const failure = await operationFailure(
        rejection({ reason: "graph_invalid", issues }),
      );
      expect(failure?.details).toEqual({ reason: "graph_invalid", issues });
    },
  );
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
