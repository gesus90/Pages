import { describe, expect, it } from "vitest";

import {
  isAgentTicketLinkOperation,
  isAgentTicketNavigationRead,
  readAgentAssignmentTargetSearch,
  readAgentTicketLinkAdd,
  readAgentTicketLinkRemove,
  readAgentTicketLinksRead,
  readAgentTicketSearch,
  readAgentTicketTree,
} from "@/backend/service/agents/AgentTicketNavigationValidation";

import { expectInvalidRequest } from "./operation-error-expectation";

describe("operation name guards", () => {
  it("knows the navigation reads and the link operations", () => {
    expect(isAgentTicketNavigationRead("tickets.search")).toBe(true);
    expect(isAgentTicketNavigationRead("tickets.link.add")).toBe(false);
    expect(isAgentTicketLinkOperation("tickets.link.remove")).toBe(true);
    expect(isAgentTicketLinkOperation("tickets.search")).toBe(false);
    expect(isAgentTicketLinkOperation(null)).toBe(false);
  });
});

describe("readAgentTicketSearch", () => {
  it("needs only the project and passes the raw window through", () => {
    expect(
      readAgentTicketSearch({
        projectId: "project-1",
        cursor: "abc",
        limit: 500,
      }),
    ).toEqual({
      search: { projectId: "project-1" },
      window: { cursor: "abc", limit: 500 },
    });
  });

  it("reads every filter that is present", () => {
    const { search } = readAgentTicketSearch({
      projectId: "project-1",
      text: "  login bug  ",
      type: "task",
      parentId: "/tasks/page-3",
      statusId: "status-1",
      milestoneId: "milestone-1",
      departmentId: "department-1",
      assigneeId: "user-1",
      tagIds: ["tag-1", "tag-2", "tag-1"],
    });
    expect(search).toEqual({
      projectId: "project-1",
      text: "login bug",
      type: "task",
      parent: { key: "PAGE-3" },
      statusId: "status-1",
      milestoneId: "milestone-1",
      departmentId: "department-1",
      assigneeId: "user-1",
      tagIds: ["tag-1", "tag-2"],
    });
  });

  it("refuses filtering by a person and a group at once", () => {
    expectInvalidRequest(() =>
      readAgentTicketSearch({
        projectId: "project-1",
        assigneeId: "user-1",
        assigneeGroupId: "group-1",
      }),
    );
  });

  it.each([
    ["no project", {}],
    ["an unknown parameter", { projectId: "p", sort: "asc" }],
    ["blank text", { projectId: "p", text: "   " }],
    ["text that is not a string", { projectId: "p", text: 4 }],
    ["an unknown type", { projectId: "p", type: "bug" }],
    ["a null status filter", { projectId: "p", statusId: null }],
    [
      "a parent that names no ticket",
      { projectId: "p", parentId: "no ticket!" },
    ],
    ["tags that are no list", { projectId: "p", tagIds: "tag-1" }],
    ["a blank tag", { projectId: "p", tagIds: [" "] }],
    [
      "more than 50 tags",
      { projectId: "p", tagIds: Array.from({ length: 51 }, (_, i) => `t${i}`) },
    ],
  ])("refuses a search with %s", (_, input) => {
    expectInvalidRequest(() => readAgentTicketSearch(input));
  });

  it("accepts exactly 50 tags", () => {
    const tagIds = Array.from({ length: 50 }, (_, index) => `tag-${index}`);
    const { search } = readAgentTicketSearch({ projectId: "p", tagIds });
    expect(search.tagIds).toHaveLength(50);
  });

  it("counts text characters as code points, with 200 as the limit", () => {
    const text = (length: number): unknown => ({
      projectId: "p",
      text: "😀".repeat(length),
    });
    expect(readAgentTicketSearch(text(200)).search.text).toHaveLength(400);
    expectInvalidRequest(() => readAgentTicketSearch(text(201)));
  });
});

describe("readAgentTicketTree", () => {
  it("accepts a project alone, a ticket alone, or both", () => {
    expect(readAgentTicketTree({ projectId: "p" })).toMatchObject({
      projectId: "p",
      ticket: null,
    });
    expect(readAgentTicketTree({ ticketId: "page-1" })).toMatchObject({
      projectId: null,
      ticket: { key: "PAGE-1" },
    });
    expect(
      readAgentTicketTree({
        projectId: "p",
        ticketId: "ticket-uuid",
        limit: 5,
      }),
    ).toEqual({
      projectId: "p",
      ticket: { id: "ticket-uuid" },
      window: { cursor: undefined, limit: 5 },
    });
  });

  it.each([
    ["neither project nor ticket", {}],
    ["only a window", { limit: 5 }],
    ["an unknown parameter", { projectId: "p", depth: 2 }],
    ["a blank project", { projectId: "" }],
  ])("refuses %s", (_, input) => {
    expectInvalidRequest(() => readAgentTicketTree(input));
  });
});

describe("readAgentTicketLinksRead", () => {
  it("reads the ticket and the window", () => {
    expect(
      readAgentTicketLinksRead({ ticketId: "page-2", cursor: "c" }),
    ).toEqual({
      ticket: { key: "PAGE-2" },
      window: { cursor: "c", limit: undefined },
    });
  });

  it.each([{}, { ticketId: 3 }, { ticketId: "page-2", all: true }])(
    "refuses %j",
    (input) => {
      expectInvalidRequest(() => readAgentTicketLinksRead(input));
    },
  );
});

describe("readAgentAssignmentTargetSearch", () => {
  it("reads an empty search as no narrowing at all", () => {
    expect(readAgentAssignmentTargetSearch({})).toEqual({
      text: null,
      targetType: null,
      projectId: null,
      window: { cursor: undefined, limit: undefined },
    });
  });

  it.each(["person", "group", "department"])(
    "accepts the target type %s",
    (targetType) => {
      expect(
        readAgentAssignmentTargetSearch({ targetType, text: " ann " }),
      ).toMatchObject({ targetType, text: "ann" });
    },
  );

  it.each([
    ["an unknown target type", { targetType: "team" }],
    ["blank text", { text: " " }],
    ["a blank project", { projectId: "" }],
    ["an unknown parameter", { role: "admin" }],
  ])("refuses %s", (_, input) => {
    expectInvalidRequest(() => readAgentAssignmentTargetSearch(input));
  });
});

describe("ticket link changes", () => {
  const add = {
    operationId: "op-1",
    ticketId: "page-1",
    targetTicketId: "/tasks/page-2",
    linkType: "duplicates",
  };

  it("reads a link addition with both tickets resolved", () => {
    expect(readAgentTicketLinkAdd(add)).toEqual({
      operationId: "op-1",
      ticket: { key: "PAGE-1" },
      target: { key: "PAGE-2" },
      linkType: "duplicates",
    });
  });

  it.each(["prerequisite", "follows", "", 1])(
    "refuses the milestone-only or unknown link type %j",
    (linkType) => {
      expectInvalidRequest(() => readAgentTicketLinkAdd({ ...add, linkType }));
    },
  );

  it("reads a removal by link identifier", () => {
    expect(
      readAgentTicketLinkRemove({
        operationId: "op-2",
        ticketId: "page-1",
        linkId: "link-1",
      }),
    ).toEqual({
      operationId: "op-2",
      ticket: { key: "PAGE-1" },
      linkId: "link-1",
    });
  });

  it("refuses a removal that also names a target", () => {
    expectInvalidRequest(() =>
      readAgentTicketLinkRemove({
        operationId: "op-2",
        ticketId: "page-1",
        linkId: "link-1",
        targetTicketId: "page-2",
      }),
    );
  });
});
