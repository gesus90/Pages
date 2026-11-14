import { describe, expect, it } from "vitest";

import { PlanNotationAttributes } from "@/backend/service/mcp/plan/PlanNotationAttributes";
import { PlanNotationNames } from "@/backend/service/mcp/plan/PlanNotationNames";
import { readPlanNotationFields } from "@/backend/service/mcp/plan/PlanNotationNodeFields";

import type { PlanNotationIssue } from "@/backend/service/mcp/plan/PlanNotationIssue";
import type { PlanNotationContext } from "@/backend/service/mcp/plan/PlanNotationContext";
import type { PlanNotationNodeType } from "@/backend/service/mcp/plan/PlanNotationVocabulary";

function readFields(
  type: PlanNotationNodeType,
  entries: Record<string, string> = {},
): { fields: Record<string, unknown>; issues: PlanNotationIssue[] } {
  const findings: PlanNotationContext["findings"] = { issues: [] };
  const sources: PlanNotationContext["sources"] = { agents: [], tasks: [] };
  const context: PlanNotationContext = {
    names: new PlanNotationNames({ workspaces: [], sources, wikiPages: [] }),
    sources,
    previous: null,
    planTarget: { kind: "local" },
    findings,
  };
  const location = { line: 1, column: 1 };
  const attributes = new PlanNotationAttributes(
    Object.entries(entries).map(([key, text]) => ({
      ...location,
      key,
      value: { ...location, kind: "string", text },
    })),
    { nodeId: "node", location },
    findings,
  );
  const fields = readPlanNotationFields(type, attributes, context, "node");
  attributes.finish();
  return { fields, issues: findings.issues };
}

describe("plan notation node fields", () => {
  it("reads script lists, target, interpreter and timeout", () => {
    const result = readFields("script", {
      name: "Build",
      target: "local",
      interpreterProfileId: "shell",
      content: "run",
      inputs: "ticket!, goal",
      outputs: "ok:gate, report:report, text",
      timeout: "42",
    });
    expect(result.fields).toEqual({
      name: "Build",
      executionTarget: { kind: "local" },
      role: undefined,
      interpreterProfileId: "shell",
      content: "run",
      inputs: [
        { name: "ticket", type: "text", isRequired: true },
        { name: "goal", type: "text", isRequired: false },
      ],
      outputs: [
        { name: "ok", type: "text", policy: "gate" },
        { name: "report", type: "text", policy: "report" },
        { name: "text", type: "text" },
      ],
      timeoutSeconds: 42,
    });
    expect(result.issues).toEqual([]);
  });

  it("accepts JSON lists and reports an unknown output policy", () => {
    expect(
      readFields("script", { inputs: '[{"name":"x"}]', outputs: ' ["y"]' })
        .fields,
    ).toMatchObject({
      inputs: [{ name: "x" }],
      outputs: ["y"],
    });
    expect(readFields("script", { outputs: "result:wrong" }).issues).toEqual([
      expect.objectContaining({ code: "invalid_value", nodeId: "node" }),
    ]);
  });

  it("reads task identifiers and reports missing or unresolved tickets", () => {
    expect(readFields("task", { taskId: "id-1" }).fields).toEqual({
      taskId: "id-1",
    });
    expect(readFields("task").issues).toEqual([
      expect.objectContaining({ code: "invalid_value" }),
    ]);
    expect(readFields("task", { ticket: "missing" }).issues).toEqual([
      expect.objectContaining({ code: "name_not_found" }),
    ]);
  });

  it("reads parameter defaults, numeric values and missing typed values", () => {
    expect(readFields("parameter").fields).toEqual({
      name: "node",
      format: "string",
      value: { type: "text", text: "" },
    });
    expect(
      readFields("parameter", { valueType: "number", value: "3.5" }).fields,
    ).toEqual({
      name: "node",
      format: "number",
      value: { type: "number", number: 3.5 },
    });
    expect(readFields("parameter", { valueType: "wiki" }).issues).toEqual([
      expect.objectContaining({ code: "invalid_value" }),
    ]);
  });
});

describe("plan notation composite fields", () => {
  it("reads loop and group settings including JSON fields", () => {
    expect(
      readFields("loop", {
        runs: "3",
        runsSource: "parameter",
        countMode: "expected",
        sessionPolicy: "fresh",
        mode: "while",
        condition: "null",
        while: "{}",
      }).fields,
    ).toEqual({
      name: "node",
      runs: 3,
      runsSource: "parameter",
      countMode: "expected",
      sessionPolicy: "fresh",
      condition: null,
      mode: "while",
      while: {},
      edges: [],
    });
    expect(readFields("group", { parameters: '["legacy"]' }).fields).toEqual({
      name: "node",
      parameters: ["legacy"],
      edges: [],
    });
  });

  it("reads decision, swarm, asset, variable and closeout fields", () => {
    expect(
      readFields("decision", {
        name: "Choice",
        mode: "model",
        output: "classification",
        question: "Which?",
        model: "{}",
        cases: '["yes"]',
      }).fields,
    ).toEqual({
      name: "Choice",
      mode: "model",
      output: "classification",
      question: "Which?",
      model: {},
      cases: ["yes"],
    });
    expect(
      readFields("swarm", {
        name: "Team",
        task: "{}",
        main: "{}",
        workers: "[]",
        directory: "repo",
        timeoutMinutes: "5",
        executionTarget: '{"kind":"local"}',
      }).fields,
    ).toEqual({
      name: "Team",
      task: {},
      main: {},
      workers: [],
      directory: "repo",
      timeoutMinutes: 5,
      executionTarget: { kind: "local" },
    });
    expect(readFields("asset", { file: '{"id":"f"}' }).fields).toEqual({
      name: "node",
      file: { id: "f" },
    });
    expect(readFields("variable", { name: "answer" }).fields).toEqual({
      name: "answer",
    });
    expect(
      readFields("git_closeout", { checkCommand: "test", timeoutSeconds: "20" })
        .fields,
    ).toEqual({ name: "node", checkCommand: "test", timeoutSeconds: 20 });
  });

  it("reads stack JSON and reports unresolved ticket entries", () => {
    expect(readFields("stack", { entries: '[{"id":"entry"}]' }).fields).toEqual(
      { name: "node", entries: [{ id: "entry" }] },
    );
    const result = readFields("stack", { entries: "missing" });
    expect(result.fields).toEqual({ name: "node", entries: [] });
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "name_not_found" }),
    ]);
  });
});
