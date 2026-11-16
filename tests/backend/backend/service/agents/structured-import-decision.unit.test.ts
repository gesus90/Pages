import { expect, it, vi } from "vitest";

import {
  compareDependencyTarget,
  compareMilestoneTarget,
  compareTicketTarget,
  structuredStepHash,
} from "@/backend/service/agents/StructuredImportDecision";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { StoredAgentImportSource } from "@/backend/database/repositories/agents/AgentImportRepository";
import type { StructuredImportEnvironment } from "@/backend/service/agents/StructuredImportEnvironment";
import type {
  StructuredImportGraph,
  StructuredTicketStep,
} from "@/backend/service/agents/StructuredImportPlanner";

const STEP: StructuredTicketStep = {
  kind: "ticket",
  key: "ticket:one",
  name: "one",
  project: "project",
  label: "Ticket",
};
const GRAPH = partial<StructuredImportGraph>({
  sources: {
    tickets: new Map([
      [
        "one",
        {
          kind: "ticket",
          key: "one",
          project: "project",
          type: "task",
          title: " Title ",
          description: " Body ",
        },
      ],
    ]),
    milestones: new Map(),
    projects: new Map(),
  },
  parents: new Map(),
  milestones: new Map(),
});
const MAPPING = partial<StoredAgentImportSource>({
  targetKind: "ticket",
  targetId: "target",
  contentHash: "hash",
});

it("hashes normalized ticket fields and their project and link context", () => {
  const projectIds = new Map([["project", "project-id"]]);
  const first = structuredStepHash(STEP, GRAPH, projectIds);
  expect(first).toMatch(/^[a-f0-9]{64}$/u);
  expect(
    structuredStepHash(
      STEP,
      { ...GRAPH, parents: new Map([["one", "parent"]]) },
      projectIds,
    ),
  ).not.toBe(first);
  expect(structuredStepHash(STEP, GRAPH, new Map())).not.toBe(first);
});

it("distinguishes unchanged, source-changed and target-changed tickets", async () => {
  const getById = vi.fn(async () => ({
    type: "task",
    title: "Title",
    description: "Body",
    parentId: null,
    milestoneId: null,
  }));
  const environment = partial<StructuredImportEnvironment>({
    actor: {},
    tasks: { tasks: { getById } },
  });
  const input = {
    step: STEP,
    graph: GRAPH,
    hash: "hash",
    resolved: { parentId: null, milestoneId: null },
  };
  await expect(
    compareTicketTarget(environment, MAPPING, input),
  ).resolves.toEqual({
    action: "unchanged",
    reason: null,
    shouldRefresh: false,
  });
  await expect(
    compareTicketTarget(environment, MAPPING, { ...input, hash: "new" }),
  ).resolves.toEqual({
    action: "unchanged",
    reason: null,
    shouldRefresh: true,
  });
  getById.mockResolvedValue({
    type: "task",
    title: "Changed",
    description: "Body",
    parentId: null,
    milestoneId: null,
  });
  await expect(
    compareTicketTarget(environment, MAPPING, input),
  ).resolves.toMatchObject({ action: "conflict", reason: "target_changed" });
  await expect(
    compareTicketTarget(environment, MAPPING, { ...input, hash: "new" }),
  ).resolves.toMatchObject({ action: "conflict", reason: "source_changed" });
  await expect(
    compareTicketTarget(environment, { ...MAPPING, targetKind: "wiki" }, input),
  ).resolves.toMatchObject({ action: "conflict", reason: "target_removed" });
});

it("compares milestone and dependency targets with current project reads", async () => {
  const milestone = {
    kind: "milestone",
    key: "one",
    project: "project",
    name: " Milestone ",
    description: " Description ",
    startAt: null,
    dueAt: null,
  };
  const graph = partial<StructuredImportGraph>({
    ...GRAPH,
    sources: { ...GRAPH.sources, milestones: new Map([["one", milestone]]) },
  });
  const environment = partial<StructuredImportEnvironment>({
    actor: {},
    tasks: {
      tasks: {
        findMilestones: async () => [
          {
            id: "target",
            name: "Milestone",
            description: "Description",
            startAt: null,
            dueAt: null,
          },
        ],
        findDependencies: async () => [{ id: "link" }],
      },
    },
  });
  const step = {
    kind: "milestone" as const,
    key: "milestone:one",
    name: "one",
    project: "project",
    label: "Milestone",
  };
  await expect(
    compareMilestoneTarget(
      environment,
      { ...MAPPING, targetKind: "milestone" },
      { step, graph, hash: "hash", projectId: "project-id" },
    ),
  ).resolves.toMatchObject({ action: "unchanged" });
  const dependency = {
    kind: "dependency" as const,
    key: "dependency",
    name: "dependency",
    label: "Dependency",
    project: "project",
    from: "one",
    to: "two",
    linkType: "blocks" as const,
  };
  await expect(
    compareDependencyTarget(
      environment,
      { ...MAPPING, targetKind: "dependency", targetId: "link" },
      { step: dependency, hash: "hash", projectId: "project-id" },
    ),
  ).resolves.toMatchObject({ action: "unchanged" });
  await expect(
    compareDependencyTarget(
      environment,
      { ...MAPPING, targetKind: "dependency", targetId: "missing" },
      { step: dependency, hash: "hash", projectId: "project-id" },
    ),
  ).resolves.toMatchObject({ reason: "target_removed" });
});
