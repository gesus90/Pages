import { expect, it } from "vitest";

import {
  withoutWorkspaceReferences,
  workspaceReferenceIds,
} from "@/backend/agents/AgentWorkspaceReferences";

it("collects every non-empty workspace identifier in nested content", () => {
  const plan = {
    workspaceId: "w-1",
    nodes: [
      { workspaceId: "w-2", settings: { workspaceId: "" } },
      [{ runnerRoute: { workspaceId: "w-3" } }, "text", null],
    ],
    other: { workspaceId: 7 },
  };

  expect([...workspaceReferenceIds(plan)].sort()).toEqual([
    "w-1",
    "w-2",
    "w-3",
  ]);
});

it("returns no identifiers for scalar content", () => {
  expect(workspaceReferenceIds("w-1").size).toBe(0);
});

it("marks a removed remote target missing rather than silently retargeting", () => {
  const plan = {
    executionTarget: { workspaceId: "w-1" },
    runnerRoute: { workspaceId: "w-1" },
    title: "Keep",
  };

  expect(withoutWorkspaceReferences(plan, "w-1")).toEqual({
    title: "Keep",
    executionTarget: { kind: "remote", workspaceId: "missing-workspace" },
  });
});

it("keeps routes of other workspaces and clears direct bindings", () => {
  const plan = {
    executionTarget: { workspaceId: "w-2" },
    runnerRoute: "local",
    steps: [{ workspaceId: "w-1", model: "m" }, { workspaceId: "w-2" }, 5],
  };

  expect(withoutWorkspaceReferences(plan, "w-1")).toEqual({
    executionTarget: { workspaceId: "w-2" },
    runnerRoute: "local",
    steps: [{ workspaceId: "", model: "m" }, { workspaceId: "w-2" }, 5],
  });
});

it("nulls nullable defaults and literal values bound to the workspace", () => {
  const parameters = [
    { defaultValue: { workspaceId: "w-1" } },
    { kind: "literal", value: { workspaceId: "w-1" } },
    { kind: "reference", value: { workspaceId: "w-1" } },
    { kind: "literal", value: { workspaceId: "w-2" } },
  ];

  expect(withoutWorkspaceReferences(parameters, "w-1")).toEqual([
    { defaultValue: null },
    { kind: "literal", value: null },
    { kind: "reference", value: { workspaceId: "" } },
    { kind: "literal", value: { workspaceId: "w-2" } },
  ]);
});

it("returns scalar content unchanged", () => {
  expect(withoutWorkspaceReferences("w-1", "w-1")).toBe("w-1");
  expect(withoutWorkspaceReferences(null, "w-1")).toBeNull();
});
