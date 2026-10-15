import { describe, expect, it } from "vitest";

import { readAgentTicketCreate } from "@/backend/service/agents/AgentTicketValidation";

import { expectInvalidRequest } from "./operation-error-expectation";

const REQUIRED = {
  operationId: "op-1",
  type: "task",
  title: "Write the guide",
  description: "",
  statusId: null,
  parentId: null,
};

describe("readAgentTicketCreate", () => {
  it("leaves every optional field open when it is absent", () => {
    expect(readAgentTicketCreate(REQUIRED)).toEqual({
      operationId: "op-1",
      projectId: null,
      type: "task",
      title: "Write the guide",
      description: "",
      statusId: null,
      parent: null,
      milestoneId: null,
    });
  });

  it("resolves a parent named by key, address or identifier", () => {
    expect(
      readAgentTicketCreate({ ...REQUIRED, parentId: "page-4" }).parent,
    ).toEqual({ key: "PAGE-4" });
    expect(
      readAgentTicketCreate({ ...REQUIRED, parentId: "/tasks/PAGE-4" }).parent,
    ).toEqual({ key: "PAGE-4" });
    expect(
      readAgentTicketCreate({ ...REQUIRED, parentId: "parent-id" }).parent,
    ).toEqual({ id: "parent-id" });
  });

  it("keeps explicit project, milestone, department and status", () => {
    const result = readAgentTicketCreate({
      ...REQUIRED,
      projectId: "project-1",
      milestoneId: "milestone-1",
      departmentId: "department-1",
      statusId: "status-1",
    });
    expect(result).toMatchObject({
      projectId: "project-1",
      milestoneId: "milestone-1",
      departmentId: "department-1",
      statusId: "status-1",
    });
  });

  it("distinguishes an explicit null department from an absent one", () => {
    expect(readAgentTicketCreate(REQUIRED)).not.toHaveProperty("departmentId");
    expect(
      readAgentTicketCreate({ ...REQUIRED, departmentId: null }),
    ).toHaveProperty("departmentId", null);
  });

  it.each([
    [{ targetType: "person", targetId: "user-1" }],
    [{ targetType: "group", targetId: "group-1" }],
    [{ targetType: "none", targetId: null }],
    [null],
  ])("accepts the assignee %j", (assignee) => {
    expect(readAgentTicketCreate({ ...REQUIRED, assignee })).toMatchObject({
      assignee,
    });
  });

  it.each([
    ["an unknown target type", { targetType: "team", targetId: "t" }],
    ["none with a target", { targetType: "none", targetId: "user-1" }],
    ["a person without a target", { targetType: "person", targetId: null }],
    ["a person with a blank target", { targetType: "person", targetId: " " }],
    ["a group without a target field", { targetType: "group" }],
    ["an extra field", { targetType: "person", targetId: "u", role: "x" }],
    ["a string", "user-1"],
    ["an array", []],
  ])("refuses an assignee with %s", (_, assignee) => {
    expectInvalidRequest(() =>
      readAgentTicketCreate({ ...REQUIRED, assignee }),
    );
  });

  it.each([
    ["an unknown type", { type: "story" }],
    ["a missing type", { type: undefined }],
    ["a title that is not text", { title: 3 }],
    ["a null description", { description: null }],
    ["an undefined status", { statusId: undefined }],
    ["an undefined parent", { parentId: undefined }],
    ["a blank operation ID", { operationId: "  " }],
    ["a parent that names no ticket", { parentId: "not a ticket!" }],
    ["a blank project", { projectId: "" }],
    ["an unknown parameter", { priority: "high" }],
  ])("refuses %s", (_, change) => {
    const fields = Object.fromEntries(
      Object.entries({ ...REQUIRED, ...change }).filter(
        ([key, value]) => !(key in change && value === undefined),
      ),
    );
    expectInvalidRequest(() => readAgentTicketCreate(fields));
  });

  it.each(["initiative", "epic", "task", "subtask"])(
    "accepts the type %s",
    (type) => {
      expect(readAgentTicketCreate({ ...REQUIRED, type }).type).toBe(type);
    },
  );
});
