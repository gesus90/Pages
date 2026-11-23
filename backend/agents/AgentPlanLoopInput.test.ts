import { describe, expect, it } from "vitest";

import {
  containedCount,
  readPlanLoopCondition,
  readPlanLoopValue,
  readPlanLoopWhile,
} from "@/backend/agents/AgentPlanLoopInput";

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanSignal } from "@/definition/AgentPlanJump";

function rejects(read: () => unknown): void {
  expect(read).toThrowError(
    expect.objectContaining({ code: "plan_loop_invalid" }),
  );
}

describe("readPlanLoopValue", () => {
  it.each([
    [{ type: "null" }, { type: "null" }],
    [
      { type: "boolean", value: false },
      { type: "boolean", value: false },
    ],
    [
      { type: "number", value: 4.5 },
      { type: "number", value: 4.5 },
    ],
    [
      { type: "string", value: "ok" },
      { type: "string", value: "ok" },
    ],
  ])("reads %j", (input, expected) => {
    expect(readPlanLoopValue(input)).toEqual(expected);
  });

  it("accepts a string at the length limit", () => {
    const value = "x".repeat(1_000);
    expect(readPlanLoopValue({ type: "string", value })).toEqual({
      type: "string",
      value,
    });
  });

  it.each([
    ["a mistyped boolean", { type: "boolean", value: "true" }],
    ["a mistyped number", { type: "number", value: "1" }],
    ["a non-finite number", { type: "number", value: Infinity }],
    ["a mistyped string", { type: "string", value: 1 }],
    ["a too long string", { type: "string", value: "x".repeat(1_001) }],
    ["an unknown type", { type: "object" }],
    ["a non-object", "text"],
  ])("rejects %s", (description, input) => {
    expect(description).not.toBe("");
    rejects(() => readPlanLoopValue(input));
  });
});

describe("readPlanLoopCondition", () => {
  const condition = {
    isEnabled: true,
    sourceNodeId: "node",
    outputPath: "$.done",
    operator: "equals",
    expected: { type: "boolean", value: true },
  };

  it("reads no condition from null and undefined", () => {
    expect(readPlanLoopCondition(null)).toBeNull();
    expect(readPlanLoopCondition(undefined)).toBeNull();
  });

  it("reads a condition with a path and with an empty path", () => {
    expect(readPlanLoopCondition(condition)).toEqual(condition);
    expect(readPlanLoopCondition({ ...condition, outputPath: "" })).toEqual({
      ...condition,
      outputPath: "",
    });
  });

  it.each([
    ["a mistyped switch", { ...condition, isEnabled: "yes" }],
    ["a missing source", { ...condition, sourceNodeId: 1 }],
    ["a too long source", { ...condition, sourceNodeId: "n".repeat(101) }],
    ["another operator", { ...condition, operator: "differs" }],
    ["a mistyped path", { ...condition, outputPath: 1 }],
    ["an unsupported path", { ...condition, outputPath: "done" }],
    ["a malformed expected value", { ...condition, expected: { type: "x" } }],
  ])("rejects %s", (description, input) => {
    expect(description).not.toBe("");
    rejects(() => readPlanLoopCondition(input));
  });
});

describe("readPlanLoopWhile", () => {
  it("reads no setting from null", () => {
    expect(readPlanLoopWhile(null)).toBeNull();
  });

  it("reads a member with a path and an empty path", () => {
    expect(
      readPlanLoopWhile({ sourceNodeId: "node", outputPath: "$[0]" }),
    ).toEqual({ sourceNodeId: "node", outputPath: "$[0]" });
    expect(readPlanLoopWhile({ sourceNodeId: "", outputPath: "" })).toEqual({
      sourceNodeId: "",
      outputPath: "",
    });
  });

  it.each([
    ["an unknown field", { sourceNodeId: "n", outputPath: "", extra: 1 }],
    ["a mistyped member", { sourceNodeId: 1, outputPath: "" }],
    ["a too long member", { sourceNodeId: "n".repeat(101), outputPath: "" }],
    ["a mistyped path", { sourceNodeId: "n", outputPath: null }],
    ["an unsupported path", { sourceNodeId: "n", outputPath: "x" }],
  ])("rejects %s", (description, input) => {
    expect(description).not.toBe("");
    rejects(() => readPlanLoopWhile(input));
  });
});

describe("containedCount", () => {
  const signal: AgentPlanSignal = {
    id: "signal",
    type: "signal",
    x: 0,
    y: 0,
    signalName: "ready",
    bindings: {},
  };
  const loop: AgentPlanLoop = {
    id: "loop",
    type: "loop",
    name: "Loop",
    x: 0,
    y: 0,
    steps: [],
    edges: [],
    runs: 1,
    runsSource: "value",
    bindings: {},
    countMode: "max",
    sessionPolicy: "reuse",
    condition: null,
  };
  const group: AgentPlanGroup = {
    id: "group",
    type: "group",
    name: "Group",
    x: 0,
    y: 0,
    steps: [],
    loops: [loop],
    parameters: [],
    bindings: {},
  };

  it("counts no node inside a plain node", () => {
    expect(containedCount(signal)).toBe(0);
  });

  it("counts the nodes a group and its loops hold", () => {
    expect(containedCount(group)).toBe(1);
    expect(containedCount(loop)).toBe(0);
  });
});
