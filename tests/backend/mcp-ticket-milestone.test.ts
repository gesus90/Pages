import { expect, it, vi } from "vitest";

vi.mock("../../mcp/src/verification", () => ({ verifyPages: vi.fn() }));
vi.mock("../../mcp/src/tools/read-operation", () => ({
  readOperation: vi.fn(),
}));

import { PagesOperationFailure } from "../../mcp/src/tools/operation-failure";
import { readOperation } from "../../mcp/src/tools/read-operation";
import { READ_TOOLS } from "../../mcp/src/tools/registry";
import { WRITE_TOOLS } from "../../mcp/src/tools/write-registry";
import { verifyPages } from "../../mcp/src/verification";
import { connectMcpServer } from "../helpers/mcp-server";

const identity = { userId: "writer", isAdmin: false, permissions: ["write"] };
const configuration = {
  agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
  token: "isolated-test-token",
};
const identifier = { type: "string", minLength: 1, maxLength: 200 };
const nullableIdentifier = {
  type: ["string", "null"],
  minLength: 1,
  maxLength: 200,
};
const date = { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const schemas = [
  {
    operation: "ticket.read",
    name: "read_ticket",
    properties: { ticketId: identifier },
  },
  {
    operation: "milestones.read",
    name: "read_milestones",
    properties: { projectId: identifier },
  },
  {
    operation: "ticket.create",
    name: "create_ticket",
    properties: {
      operationId: identifier,
      projectId: identifier,
      type: { enum: ["initiative", "epic", "task", "subtask"] },
      title: identifier,
      description: { type: "string", maxLength: 65536 },
      statusId: nullableIdentifier,
      parentId: nullableIdentifier,
      milestoneId: nullableIdentifier,
    },
  },
  {
    operation: "ticket.setTitle",
    name: "set_ticket_title",
    properties: {
      operationId: identifier,
      ticketId: identifier,
      expectedTitle: identifier,
      title: identifier,
    },
  },
  {
    operation: "ticket.setDescription",
    name: "set_ticket_description",
    properties: {
      operationId: identifier,
      ticketId: identifier,
      expectedDescription: { type: "string", maxLength: 65536 },
      description: { type: "string", maxLength: 65536 },
    },
  },
  {
    operation: "ticket.setStatus",
    name: "set_ticket_status",
    properties: {
      operationId: identifier,
      ticketId: identifier,
      expectedStatusId: identifier,
      statusId: identifier,
    },
  },
  {
    operation: "ticket.setParent",
    name: "set_ticket_parent",
    properties: {
      operationId: identifier,
      ticketId: identifier,
      expectedParentId: nullableIdentifier,
      parentId: nullableIdentifier,
    },
  },
  {
    operation: "milestone.create",
    name: "create_milestone",
    properties: {
      operationId: identifier,
      projectId: identifier,
      name: identifier,
      description: { type: "string" },
      startAt: date,
      dueAt: date,
    },
  },
  {
    operation: "milestone.setName",
    name: "set_milestone_name",
    properties: {
      operationId: identifier,
      milestoneId: identifier,
      expectedName: identifier,
      name: identifier,
    },
  },
  {
    operation: "milestone.setDescription",
    name: "set_milestone_description",
    properties: {
      operationId: identifier,
      milestoneId: identifier,
      expectedDescription: { type: "string" },
      description: { type: "string" },
    },
  },
  {
    operation: "milestone.setStatus",
    name: "set_milestone_status",
    properties: {
      operationId: identifier,
      milestoneId: identifier,
      expectedStatus: { enum: ["open", "completed", "archived"] },
      status: { enum: ["open", "completed", "archived"] },
    },
  },
  {
    operation: "milestone.setStartAt",
    name: "set_milestone_start",
    properties: {
      operationId: identifier,
      milestoneId: identifier,
      expectedStartAt: date,
      startAt: date,
    },
  },
  {
    operation: "milestone.setDueAt",
    name: "set_milestone_due",
    properties: {
      operationId: identifier,
      milestoneId: identifier,
      expectedDueAt: date,
      dueAt: date,
    },
  },
  {
    operation: "milestone.dependency.add",
    name: "add_milestone_dependency",
    properties: {
      operationId: identifier,
      projectId: identifier,
      sourceId: identifier,
      targetId: identifier,
      linkType: { enum: ["prerequisite", "follows", "blocks", "relates_to"] },
    },
  },
  {
    operation: "milestone.dependency.remove",
    name: "remove_milestone_dependency",
    properties: {
      operationId: identifier,
      projectId: identifier,
      dependencyId: identifier,
    },
  },
];

const calls = [
  ["read_ticket", "ticket.read", { ticketId: "/tasks/PAGE-1" }],
  ["read_milestones", "milestones.read", { projectId: "project" }],
  [
    "create_ticket",
    "ticket.create",
    {
      operationId: "create",
      projectId: "project",
      type: "task",
      title: "Title",
      description: "",
      statusId: null,
      parentId: null,
      milestoneId: null,
    },
  ],
  [
    "set_ticket_title",
    "ticket.setTitle",
    {
      operationId: "change",
      ticketId: "PAGE-1",
      expectedTitle: "Old",
      title: "New",
    },
  ],
  [
    "set_ticket_description",
    "ticket.setDescription",
    {
      operationId: "change",
      ticketId: "PAGE-1",
      expectedDescription: "Old",
      description: "New",
    },
  ],
  [
    "set_ticket_status",
    "ticket.setStatus",
    {
      operationId: "change",
      ticketId: "PAGE-1",
      expectedStatusId: "old",
      statusId: "new",
    },
  ],
  [
    "set_ticket_parent",
    "ticket.setParent",
    {
      operationId: "change",
      ticketId: "PAGE-1",
      expectedParentId: null,
      parentId: "/tasks/PAGE-2",
    },
  ],
  [
    "create_milestone",
    "milestone.create",
    {
      operationId: "create",
      projectId: "project",
      name: "Release",
      description: "",
      startAt: null,
      dueAt: null,
    },
  ],
  [
    "set_milestone_name",
    "milestone.setName",
    {
      operationId: "change",
      milestoneId: "milestone",
      expectedName: "Old",
      name: "New",
    },
  ],
  [
    "set_milestone_description",
    "milestone.setDescription",
    {
      operationId: "change",
      milestoneId: "milestone",
      expectedDescription: "Old",
      description: "New",
    },
  ],
  [
    "set_milestone_status",
    "milestone.setStatus",
    {
      operationId: "change",
      milestoneId: "milestone",
      expectedStatus: "open",
      status: "completed",
    },
  ],
  [
    "set_milestone_start",
    "milestone.setStartAt",
    {
      operationId: "change",
      milestoneId: "milestone",
      expectedStartAt: null,
      startAt: "2026-01-01",
    },
  ],
  [
    "set_milestone_due",
    "milestone.setDueAt",
    {
      operationId: "change",
      milestoneId: "milestone",
      expectedDueAt: "2026-01-01",
      dueAt: null,
    },
  ],
  [
    "add_milestone_dependency",
    "milestone.dependency.add",
    {
      operationId: "add",
      projectId: "project",
      sourceId: "source",
      targetId: "target",
      linkType: "blocks",
    },
  ],
  [
    "remove_milestone_dependency",
    "milestone.dependency.remove",
    { operationId: "remove", projectId: "project", dependencyId: "link" },
  ],
] as const;

it.each(schemas)(
  "exposes the exact required schema and annotations of $name",
  ({ operation, name, properties }) => {
    const entry = [...READ_TOOLS, ...WRITE_TOOLS].find(
      (candidate) => candidate.operation === operation,
    );
    if (!entry) throw new Error("Expected registered operation.");
    expect(entry.tool.name).toBe(name);
    expect(entry.tool.inputSchema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        ...properties,
        ...(operation === "milestones.read"
          ? {
              cursor: { type: ["string", "null"] },
              limit: { type: "integer", minimum: 1, maximum: 100 },
            }
          : {}),
      },
      required: Object.keys(properties),
    });
    expect(entry.tool.annotations).toEqual({
      readOnlyHint: operation.endsWith(".read"),
      destructiveHint: name.startsWith("set_") || name.startsWith("remove_"),
      idempotentHint: true,
      openWorldHint: false,
    });
  },
);

it.each(calls)(
  "forwards %s unchanged, preserves conflicts and rechecks authorization for replay",
  async (name, operation, parameters) => {
    const operations = calls.map(([, key]) => key);
    vi.mocked(verifyPages).mockResolvedValue({ identity, tools: operations });
    const { server, request } = await connectMcpServer(() => configuration);
    try {
      const result = {
        ticketId: "ticket",
        milestoneId: "milestone",
        changed: true,
      };
      vi.mocked(readOperation).mockResolvedValue(result);
      for (let attempt = 0; attempt < 2; attempt++)
        expect(
          await request("tools/call", { name, arguments: parameters }),
        ).toMatchObject({
          result: { content: [{ text: JSON.stringify(result) }] },
        });
      expect(readOperation).toHaveBeenLastCalledWith(
        configuration,
        operation,
        parameters,
      );
      vi.mocked(readOperation).mockRejectedValueOnce(
        new PagesOperationFailure("CONFLICT"),
      );
      expect(
        await request("tools/call", { name, arguments: parameters }),
      ).toMatchObject({
        result: { isError: true, content: [{ text: '{"code":"CONFLICT"}' }] },
      });
      vi.mocked(verifyPages).mockResolvedValue({
        identity: { ...identity, permissions: [] },
        tools: [],
      });
      expect(await request("tools/list")).toMatchObject({
        result: { tools: [] },
      });
      expect(
        await request("tools/call", { name, arguments: parameters }),
      ).toMatchObject({ error: { message: "Pages authorization failed." } });
      expect(readOperation).toHaveBeenCalledTimes(3);
    } finally {
      await server.close();
    }
  },
);
