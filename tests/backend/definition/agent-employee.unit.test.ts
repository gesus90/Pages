import { describe, expect, it } from "vitest";

import {
  countWords,
  hasHostTools,
  isAgentEmployeeAccess,
} from "@/definition/AgentEmployee";

describe("agent employee access", () => {
  it("accepts only the declared access modes", () => {
    expect(
      ["read_only", "workspace", "yolo"].map(isAgentEmployeeAccess),
    ).toEqual([true, true, true]);
    expect(["", "Workspace", null, 1, {}].map(isAgentEmployeeAccess)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("grants host tools only for workspace and yolo", () => {
    expect(hasHostTools("read_only")).toBe(false);
    expect(hasHostTools("workspace")).toBe(true);
    expect(hasHostTools("yolo")).toBe(true);
  });
});

describe("memory word counting", () => {
  it("counts whitespace separated words and treats blank text as empty", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(" \n\t ")).toBe(0);
    expect(countWords("  one\t two\nthree  ")).toBe(3);
    expect(countWords("one-word")).toBe(1);
  });
});
