import { expect, it } from "vitest";

import {
  isAgentMilestoneFieldOperation,
  isAgentMilestoneOperation,
  isAgentTicketFieldOperation,
  isAgentTicketOperation,
  readAgentMilestoneCreate,
  readAgentMilestoneDependencyAdd,
  readAgentMilestoneDependencyRemove,
  readAgentMilestoneFieldChange,
  readAgentMilestonesRead,
  readAgentTicketCreate,
  readAgentTicketFieldChange,
  readAgentTicketRead,
  resolveAgentTicketReference,
} from "@/backend/service/agents/AgentTicketValidation";

const ticket = {
  operationId: "create",
  projectId: "project",
  type: "task",
  title: "Title",
  description: "Body",
  statusId: null,
  parentId: null,
  milestoneId: null,
};
const milestone = {
  operationId: "create",
  projectId: "project",
  name: "Release",
  description: "Body",
  startAt: null,
  dueAt: null,
};
const dependency = {
  operationId: "link",
  projectId: "project",
  sourceId: "source",
  targetId: "target",
  linkType: "blocks",
};

it.each([
  [" ticket-id ", { id: "ticket-id" }],
  [" page-12 ", { key: "PAGE-12" }],
  ["/tasks/Page-12", { key: "PAGE-12" }],
  [
    "https://pages.invalid/prefix/aufgaben/page-12/?q=1#top",
    { key: "PAGE-12" },
  ],
  ["", null],
  ["Ticket title", null],
  ["/wiki/page-12", null],
  ["ftp://pages.invalid/tasks/PAGE-12", null],
])("resolves only explicit ticket references %j", (input, expected) => {
  expect(resolveAgentTicketReference(input)).toEqual(expected);
});

it.each([undefined, null, [], false, 1, "request"])(
  "rejects non-object parameters %j before persistence",
  (input) => {
    for (const read of [readAgentTicketCreate, readAgentMilestoneCreate])
      expect(() => read(input)).toThrow(
        expect.objectContaining({ code: "INVALID_REQUEST" }),
      );
  },
);

it("requires every declared key and rejects replaced or additional keys", () => {
  for (const [input, read] of [
    [ticket, readAgentTicketCreate],
    [milestone, readAgentMilestoneCreate],
    [dependency, readAgentMilestoneDependencyAdd],
  ] as const) {
    for (const key of Object.keys(input)) {
      const missing: Record<string, unknown> = { ...input };
      delete missing[key];
      expect(() => read(missing)).toThrow(
        expect.objectContaining({ code: "INVALID_REQUEST" }),
      );
      missing.actor = "injected";
      expect(() => read(missing)).toThrow(
        expect.objectContaining({ code: "INVALID_REQUEST" }),
      );
    }
    expect(() => read({ ...input, extra: true })).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  }
});

it.each([
  { operationId: " " },
  { operationId: "x".repeat(201) },
  { projectId: 1 },
  { type: "unknown" },
  { title: null },
  { description: 1 },
  { statusId: "" },
  { parentId: "Ticket title" },
  { milestoneId: false },
])("rejects malformed ticket creation parameters %j", (overrides) => {
  expect(() => readAgentTicketCreate({ ...ticket, ...overrides })).toThrow(
    expect.objectContaining({ code: "INVALID_REQUEST" }),
  );
});

it("reads explicit nullable and populated creation contracts without changing input", () => {
  expect(readAgentTicketCreate(ticket)).toEqual({
    ...ticket,
    parentId: undefined,
    parent: null,
  });
  const populated = {
    ...ticket,
    statusId: "status",
    parentId: "PAGE-1",
    milestoneId: "release",
  };
  expect(readAgentTicketCreate(populated)).toEqual({
    ...populated,
    parentId: undefined,
    parent: { key: "PAGE-1" },
  });
  expect(populated.parentId).toBe("PAGE-1");
  expect(readAgentMilestoneCreate(milestone)).toEqual(milestone);
  const dated = { ...milestone, startAt: "2026-01-01", dueAt: "2026-02-01" };
  expect(readAgentMilestoneCreate(dated)).toEqual(dated);
  expect(readAgentMilestoneDependencyAdd(dependency)).toEqual(dependency);
  const removal = {
    operationId: "remove",
    projectId: "project",
    dependencyId: "dependency",
  };
  expect(readAgentMilestoneDependencyRemove(removal)).toEqual(removal);
  expect(readAgentTicketRead({ ticketId: "/tasks/PAGE-1" })).toEqual({
    key: "PAGE-1",
  });
  expect(readAgentMilestonesRead({ projectId: "project" })).toBe("project");
});

it.each(
  (
    [
      ["ticket.setTitle", "title", "expectedTitle", "title", "Old", "New"],
      [
        "ticket.setDescription",
        "description",
        "expectedDescription",
        "description",
        "",
        "Body",
      ],
      [
        "ticket.setStatus",
        "status",
        "expectedStatusId",
        "statusId",
        "old",
        "new",
      ],
      [
        "ticket.setParent",
        "parent",
        "expectedParentId",
        "parentId",
        null,
        "PAGE-1",
      ],
      [
        "ticket.setParent",
        "parent",
        "expectedParentId",
        "parentId",
        "parent-id",
        null,
      ],
    ] as const
  ).map(([operation, field, expectedKey, valueKey, expected, value]) => ({
    operation,
    field,
    expectedKey,
    valueKey,
    expected,
    value,
  })),
)(
  "reads the exact field contract of $operation",
  ({ operation, field, expectedKey, valueKey, expected, value }) => {
    expect(isAgentTicketFieldOperation(operation)).toBe(true);
    expect(isAgentTicketOperation(operation)).toBe(true);
    expect(
      readAgentTicketFieldChange(operation, {
        operationId: "change",
        ticketId: "id",
        [expectedKey]: expected,
        [valueKey]: value,
      }),
    ).toEqual({
      operationId: "change",
      ticket: { id: "id" },
      field,
      expected:
        field === "parent" && expected !== null ? { id: expected } : expected,
      value: field === "parent" && value !== null ? { key: value } : value,
    });
  },
);

it.each(
  (
    [
      ["milestone.setName", "name", "expectedName", "name", "Old", "New"],
      [
        "milestone.setDescription",
        "description",
        "expectedDescription",
        "description",
        "",
        "Body",
      ],
      [
        "milestone.setStatus",
        "status",
        "expectedStatus",
        "status",
        "open",
        "completed",
      ],
      [
        "milestone.setStartAt",
        "startAt",
        "expectedStartAt",
        "startAt",
        null,
        "2026-01-01",
      ],
      [
        "milestone.setDueAt",
        "dueAt",
        "expectedDueAt",
        "dueAt",
        "2026-02-01",
        null,
      ],
    ] as const
  ).map(([operation, field, expectedKey, valueKey, expected, value]) => ({
    operation,
    field,
    expectedKey,
    valueKey,
    expected,
    value,
  })),
)(
  "reads the exact field contract of $operation",
  ({ operation, field, expectedKey, valueKey, expected, value }) => {
    expect(isAgentMilestoneFieldOperation(operation)).toBe(true);
    expect(isAgentMilestoneOperation(operation)).toBe(true);
    expect(
      readAgentMilestoneFieldChange(operation, {
        operationId: "change",
        milestoneId: "id",
        [expectedKey]: expected,
        [valueKey]: value,
      }),
    ).toEqual({
      operationId: "change",
      milestoneId: "id",
      field,
      expected,
      value,
    });
  },
);

it("classifies creates and dependency writes separately from field operations", () => {
  expect(isAgentTicketOperation("ticket.create")).toBe(true);
  for (const operation of [
    "milestone.create",
    "milestone.dependency.add",
    "milestone.dependency.remove",
  ])
    expect(isAgentMilestoneOperation(operation)).toBe(true);
  for (const operation of [undefined, null, 1, "unknown", "ticket.read"]) {
    expect(isAgentTicketOperation(operation)).toBe(false);
    expect(isAgentMilestoneOperation(operation)).toBe(false);
    expect(isAgentTicketFieldOperation(operation)).toBe(false);
    expect(isAgentMilestoneFieldOperation(operation)).toBe(false);
  }
});

it("rejects an empty target status and an unsupported dependency type", () => {
  expect(() =>
    readAgentTicketFieldChange("ticket.setStatus", {
      operationId: "change",
      ticketId: "id",
      expectedStatusId: "old",
      statusId: " ",
    }),
  ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  expect(() =>
    readAgentMilestoneDependencyAdd({ ...dependency, linkType: "unknown" }),
  ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
});
