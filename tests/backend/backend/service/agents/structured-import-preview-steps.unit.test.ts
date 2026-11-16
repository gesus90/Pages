import { expect, it, vi } from "vitest";

import {
  firstIssueByKey,
  previewSteps,
} from "@/backend/service/agents/StructuredImportStepPreview";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { StructuredImportEnvironment } from "@/backend/service/agents/StructuredImportEnvironment";
import type { StructuredImportGraph } from "@/backend/service/agents/StructuredImportPlanner";
import type { AgentStructuredIssue } from "@/definition/AgentStructuredImportManifest";

it("plans valid objects, blocks missing dependencies and flags invalid projects", async () => {
  const findSource = vi.fn(async () => null);
  const environment = partial<StructuredImportEnvironment>({
    imports: { findSource },
  });
  const graph = partial<StructuredImportGraph>({
    steps: [
      {
        kind: "ticket",
        key: "ticket:parent",
        name: "parent",
        project: "project",
        label: "Parent",
      },
      {
        kind: "ticket",
        key: "ticket:child",
        name: "child",
        project: "project",
        label: "Child",
      },
      {
        kind: "ticket",
        key: "ticket:orphan",
        name: "orphan",
        project: "project",
        label: "Orphan",
      },
      {
        kind: "ticket",
        key: "ticket:unknown",
        name: "unknown",
        project: "missing",
        label: "Unknown",
      },
    ],
    parents: new Map([
      ["child", "parent"],
      ["orphan", "absent"],
    ]),
    milestones: new Map(),
  });
  const result = await previewSteps(environment, {
    graph,
    projectIds: new Map([["project", "project-id"]]),
    errors: [],
  });
  expect(
    result.objects.map((entry) => [entry.key, entry.action, entry.reason]),
  ).toEqual([
    ["ticket:parent", "create", null],
    ["ticket:child", "create", null],
    ["ticket:orphan", "blocked", "blocked"],
    ["ticket:unknown", "invalid", null],
  ]);
  expect(findSource).toHaveBeenCalledTimes(3);
});

it("keeps the first issue per key and does not read flagged sources", async () => {
  const first = partial<AgentStructuredIssue>({
    code: "INVALID_REQUEST",
    reason: "invalid_key",
    keys: ["ticket:one"],
  });
  const second = partial<AgentStructuredIssue>({
    code: "CONFLICT",
    reason: "source_changed",
    keys: ["ticket:one"],
  });
  expect(firstIssueByKey([first, second]).get("ticket:one")).toBe(first);
  const findSource = vi.fn();
  const graph = partial<StructuredImportGraph>({
    steps: [
      {
        kind: "ticket",
        key: "ticket:one",
        name: "one",
        project: "project",
        label: "One",
      },
    ],
    parents: new Map(),
    milestones: new Map(),
  });
  const result = await previewSteps(
    partial<StructuredImportEnvironment>({ imports: { findSource } }),
    { graph, projectIds: new Map([["project", "id"]]), errors: [first] },
  );
  expect(result.objects).toMatchObject([
    { action: "invalid", reason: "invalid_key" },
  ]);
  expect(findSource).not.toHaveBeenCalled();
});
