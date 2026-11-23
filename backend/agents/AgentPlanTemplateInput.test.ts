import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  readPlanTemplate,
  readPlanTemplateName,
  readPlanTemplateNode,
} from "@/backend/agents/AgentPlanTemplateInput";
import { AgentError } from "@/backend/error/AgentErrors";

const readPlanNode = vi.hoisted(() => vi.fn());

vi.mock("@/backend/agents/AgentPlanInput", () => ({ readPlanNode }));

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof AgentError) return error.code;
  }
  return "none";
}

beforeEach(() => {
  readPlanNode.mockReset();
});

describe("readPlanTemplateName", () => {
  it("trims a valid name", () => {
    expect(readPlanTemplateName("  My template ")).toBe("My template");
  });

  it("requires a name", () => {
    expect(codeOf(() => readPlanTemplateName("  "))).toBe(
      "template_name_required",
    );
    expect(codeOf(() => readPlanTemplateName(5))).toBe(
      "template_name_required",
    );
  });

  it("rejects long names and control characters", () => {
    expect(codeOf(() => readPlanTemplateName("x".repeat(121)))).toBe(
      "template_invalid",
    );
    expect(codeOf(() => readPlanTemplateName("a\nb"))).toBe("template_invalid");
  });
});

describe("readPlanTemplateNode", () => {
  it("returns a node of a templated type", () => {
    readPlanNode.mockReturnValue({ type: "agent" });

    expect(readPlanTemplateNode('{"type":"agent"}')).toEqual({ type: "agent" });
  });

  it("rejects text that is too long or not text", () => {
    expect(codeOf(() => readPlanTemplateNode(1))).toBe("template_invalid");
    expect(codeOf(() => readPlanTemplateNode("x".repeat(2_000_001)))).toBe(
      "template_invalid",
    );
  });

  it("rejects a node type without templates", () => {
    readPlanNode.mockReturnValue({ type: "swarm" });

    expect(codeOf(() => readPlanTemplateNode("{}"))).toBe("template_invalid");
  });
});

describe("readPlanTemplate", () => {
  const record = {
    id: "i",
    name: "n",
    type: "script",
    isShared: false,
    isOwn: true,
    createdAt: "t",
    node: {},
  };

  it("reads a complete template", () => {
    readPlanNode.mockReturnValue({ type: "script" });

    expect(readPlanTemplate(record)).toEqual({
      ...record,
      node: { type: "script" },
    });
  });

  it.each([
    { id: 1 },
    { name: 1 },
    { type: 1 },
    { isShared: "no" },
    { isOwn: "no" },
    { createdAt: 1 },
    { type: "swarm" },
  ])("rejects the malformed record %j", (overrides) => {
    readPlanNode.mockReturnValue({ type: "script" });

    expect(codeOf(() => readPlanTemplate({ ...record, ...overrides }))).toBe(
      "template_invalid",
    );
  });

  it("rejects a node of another type or without templates", () => {
    readPlanNode.mockReturnValue({ type: "agent" });
    expect(codeOf(() => readPlanTemplate(record))).toBe("template_invalid");
    readPlanNode.mockReturnValue({ type: "script" });
    expect(readPlanTemplate({ ...record, type: "script" }).type).toBe("script");
  });
});
