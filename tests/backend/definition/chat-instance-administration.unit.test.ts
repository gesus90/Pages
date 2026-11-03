import { expect, it } from "vitest";

import {
  AGENT_ADMIN_READ_OPERATIONS,
  AGENT_ADMIN_WRITE_OPERATIONS,
  CHAT_ADMIN_WRITE_OPERATIONS,
  isChatOnlyAdminWriteOperation,
} from "@/definition/AgentAdministration";
import {
  ADMIN_READ_TOOLS,
  ADMIN_WRITE_TOOLS,
} from "@/definition/AgentTools/Administration";
import { CHAT_ADMINISTRATION_TOOLS } from "@/definition/AgentTools/ChatAdministration";
import { TOOL_ENTRIES } from "@/definition/AgentTools/ToolCatalog";
import {
  CHAT_INSTANCE_READ_OPERATIONS,
  CHAT_INSTANCE_WRITE_OPERATIONS,
  isChatInstanceReadOperation,
  isChatInstanceWriteOperation,
} from "@/definition/ChatInstanceAdministration";
import { readChatJobEvent } from "@/definition/ChatJobReader";

it("recognizes the instance administration reads and writes, and nothing else", () => {
  for (const operation of CHAT_INSTANCE_READ_OPERATIONS)
    expect([
      isChatInstanceReadOperation(operation),
      isChatInstanceWriteOperation(operation),
    ]).toEqual([true, false]);
  for (const operation of CHAT_INSTANCE_WRITE_OPERATIONS)
    expect([
      isChatInstanceReadOperation(operation),
      isChatInstanceWriteOperation(operation),
    ]).toEqual([false, true]);
  expect(isChatInstanceReadOperation("admin.users.list")).toBe(false);
  expect(isChatInstanceWriteOperation(7)).toBe(false);
});

it("keeps the instance administration out of the MCP and the other chat-only sets", () => {
  const mcp = TOOL_ENTRIES.map(({ operation }) => String(operation));
  for (const operation of [
    ...CHAT_INSTANCE_READ_OPERATIONS,
    ...CHAT_INSTANCE_WRITE_OPERATIONS,
    ...CHAT_ADMIN_WRITE_OPERATIONS,
  ])
    expect(mcp).not.toContain(operation);
  const mcpWrites: readonly string[] = AGENT_ADMIN_WRITE_OPERATIONS;
  for (const operation of CHAT_INSTANCE_WRITE_OPERATIONS) {
    expect(isChatOnlyAdminWriteOperation(operation)).toBe(false);
    expect(mcpWrites).not.toContain(operation);
  }
});

it("describes the whole administration of the chat without touching the contracts of MCP", () => {
  const described = CHAT_ADMINISTRATION_TOOLS.map(({ operation }) => operation);
  for (const operation of [
    ...AGENT_ADMIN_READ_OPERATIONS,
    ...AGENT_ADMIN_WRITE_OPERATIONS,
    ...CHAT_INSTANCE_READ_OPERATIONS,
    ...CHAT_INSTANCE_WRITE_OPERATIONS,
    ...CHAT_ADMIN_WRITE_OPERATIONS.filter(
      (name) =>
        name !== "admin.users.create" && name !== "admin.users.resetPassword",
    ),
  ])
    expect(described).toContain(operation);
  expect(new Set(described).size).toBe(described.length);
  const names = CHAT_ADMINISTRATION_TOOLS.map(({ tool }) => tool.name);
  expect(new Set(names).size).toBe(names.length);

  for (const mcp of [...ADMIN_READ_TOOLS, ...ADMIN_WRITE_TOOLS]) {
    const chat = CHAT_ADMINISTRATION_TOOLS.find(
      ({ operation }) => operation === mcp.operation,
    );
    expect(chat?.tool.name).toBe(mcp.tool.name);
    expect(chat?.tool.inputSchema).toEqual(mcp.tool.inputSchema);
  }
  // The MCP client still passes its own confirmation; only the chat describes it differently.
  expect(ADMIN_WRITE_TOOLS[0].tool.description).toContain("LÖSCHEN");
  expect(
    CHAT_ADMINISTRATION_TOOLS.find(
      ({ operation }) => operation === "admin.roles.setPermissions",
    )?.tool.description,
  ).not.toContain("passing that exact reply as confirmation");
});

it("reads the privilege mark of a tool call of the journal, and only a true one", () => {
  const event = {
    kind: "tool",
    callId: "call",
    tool: "list_admin_users",
    status: "running",
    error: null,
  };

  expect(readChatJobEvent({ ...event, isPrivileged: true })).toEqual({
    ...event,
    isPrivileged: true,
  });
  expect(readChatJobEvent({ ...event, isPrivileged: "yes" })).toEqual(event);
  expect(readChatJobEvent(event)).toEqual(event);
});
