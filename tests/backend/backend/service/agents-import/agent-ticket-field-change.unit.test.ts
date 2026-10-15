import { describe, expect, it } from "vitest";

import {
  isAgentMilestoneFieldOperation,
  isAgentMilestoneOperation,
  isAgentTicketFieldOperation,
  isAgentTicketOperation,
  readAgentMilestoneCreate,
  readAgentMilestoneDependencyAdd,
  readAgentMilestoneDependencyRemove,
  readAgentMilestoneFieldChange,
  readAgentTicketFieldChange,
} from "@/backend/service/agents/AgentTicketValidation";

import { expectInvalidRequest } from "./operation-error-expectation";

describe("operation name guards", () => {
  it("recognises the single-field ticket operations", () => {
    expect(isAgentTicketFieldOperation("ticket.setTitle")).toBe(true);
    expect(isAgentTicketFieldOperation("ticket.create")).toBe(false);
    expect(isAgentTicketFieldOperation(undefined)).toBe(false);
    expect(isAgentTicketFieldOperation("toString")).toBe(false);
  });

  it("recognises every ticket write", () => {
    for (const name of [
      "ticket.create",
      "ticket.patchDescription",
      "ticket.setParent",
    ])
      expect(isAgentTicketOperation(name)).toBe(true);
    expect(isAgentTicketOperation("milestone.create")).toBe(false);
  });

  it("recognises the milestone operations", () => {
    expect(isAgentMilestoneFieldOperation("milestone.setDueAt")).toBe(true);
    expect(isAgentMilestoneFieldOperation("milestone.create")).toBe(false);
    for (const name of [
      "milestone.create",
      "milestone.dependency.add",
      "milestone.dependency.remove",
      "milestone.setName",
    ])
      expect(isAgentMilestoneOperation(name)).toBe(true);
    expect(isAgentMilestoneOperation("ticket.setTitle")).toBe(false);
  });
});

describe("readAgentTicketFieldChange", () => {
  const target = { operationId: "op-1", ticketId: "PAGE-1" };

  it("reads a title change with the title it was read at", () => {
    expect(
      readAgentTicketFieldChange("ticket.setTitle", {
        ...target,
        expectedTitle: "Old",
        title: "New",
      }),
    ).toEqual({
      operationId: "op-1",
      ticket: { key: "PAGE-1" },
      field: "title",
      expected: "Old",
      value: "New",
    });
  });

  it("allows an empty description on both sides", () => {
    const change = readAgentTicketFieldChange("ticket.setDescription", {
      ...target,
      expectedDescription: "",
      description: "",
    });
    expect(change).toMatchObject({
      field: "description",
      expected: "",
      value: "",
    });
  });

  it("refuses a blank status identifier but allows a blank expected one", () => {
    expect(
      readAgentTicketFieldChange("ticket.setStatus", {
        ...target,
        expectedStatusId: "",
        statusId: "done",
      }),
    ).toMatchObject({ field: "status", expected: "", value: "done" });
    expectInvalidRequest(() =>
      readAgentTicketFieldChange("ticket.setStatus", {
        ...target,
        expectedStatusId: "todo",
        statusId: "   ",
      }),
    );
  });

  it("reads a parent change as references, where null removes the parent", () => {
    expect(
      readAgentTicketFieldChange("ticket.setParent", {
        ...target,
        expectedParentId: "page-2",
        parentId: null,
      }),
    ).toMatchObject({
      field: "parent",
      expected: { key: "PAGE-2" },
      value: null,
    });
  });

  it.each([
    [
      "a value of the wrong type",
      "ticket.setTitle",
      { expectedTitle: "a", title: 4 },
    ],
    ["a null value", "ticket.setTitle", { expectedTitle: "a", title: null }],
    [
      "the parameter names of another field",
      "ticket.setTitle",
      { expectedDescription: "a", description: "b" },
    ],
    ["a missing expected value", "ticket.setDescription", { description: "b" }],
    [
      "an unknown parameter",
      "ticket.setTitle",
      { expectedTitle: "a", title: "b", extra: 1 },
    ],
    [
      "a parent that names no ticket",
      "ticket.setParent",
      { expectedParentId: null, parentId: "no ticket!" },
    ],
  ] as const)("refuses %s", (_, operation, fields) => {
    expectInvalidRequest(() =>
      readAgentTicketFieldChange(operation, { ...target, ...fields }),
    );
  });
});

describe("readAgentMilestoneCreate", () => {
  const create = {
    operationId: "op-1",
    projectId: "project-1",
    name: "Beta",
    description: "",
    startAt: "2026-11-01",
    dueAt: null,
  };

  it("returns the complete contract with nullable dates", () => {
    expect(readAgentMilestoneCreate(create)).toEqual(create);
  });

  it.each([
    ["a date that is a number", { startAt: 20261101 }],
    ["an undefined date", { dueAt: undefined }],
    ["a missing description", { description: undefined }],
    ["a blank project", { projectId: " " }],
    ["an unknown parameter", { color: "red" }],
  ])("refuses %s", (_, change) => {
    const fields = Object.fromEntries(
      Object.entries({ ...create, ...change }).filter(
        ([key, value]) => !(key in change && value === undefined),
      ),
    );
    expectInvalidRequest(() => readAgentMilestoneCreate(fields));
  });
});

describe("readAgentMilestoneFieldChange", () => {
  const target = { operationId: "op-1", milestoneId: "milestone-1" };

  it("allows a date to be cleared", () => {
    expect(
      readAgentMilestoneFieldChange("milestone.setDueAt", {
        ...target,
        expectedDueAt: "2026-12-01",
        dueAt: null,
      }),
    ).toEqual({
      operationId: "op-1",
      milestoneId: "milestone-1",
      field: "dueAt",
      expected: "2026-12-01",
      value: null,
    });
  });

  it("refuses a null name, which is no text", () => {
    expectInvalidRequest(() =>
      readAgentMilestoneFieldChange("milestone.setName", {
        ...target,
        expectedName: "Beta",
        name: null,
      }),
    );
  });

  it("refuses a status change with the parameter names of another field", () => {
    expectInvalidRequest(() =>
      readAgentMilestoneFieldChange("milestone.setStatus", {
        ...target,
        expectedName: "a",
        name: "b",
      }),
    );
  });
});

describe("milestone dependencies", () => {
  const add = {
    operationId: "op-1",
    projectId: "project-1",
    sourceId: "milestone-1",
    targetId: "milestone-2",
    linkType: "blocks",
  };

  it("reads an addition with its link type", () => {
    expect(readAgentMilestoneDependencyAdd(add)).toEqual(add);
  });

  it.each(["duplicates", "BLOCKS", "", 3])(
    "refuses the link type %j",
    (linkType) => {
      expectInvalidRequest(() =>
        readAgentMilestoneDependencyAdd({ ...add, linkType }),
      );
    },
  );

  it("reads a removal and refuses extra parameters", () => {
    const remove = {
      operationId: "op-2",
      projectId: "project-1",
      dependencyId: "dependency-1",
    };
    expect(readAgentMilestoneDependencyRemove(remove)).toEqual(remove);
    expectInvalidRequest(() =>
      readAgentMilestoneDependencyRemove({ ...remove, linkType: "blocks" }),
    );
  });
});
