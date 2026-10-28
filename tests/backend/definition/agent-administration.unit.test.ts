import { expect, it } from "vitest";

import {
  AGENT_ADMIN_READ_OPERATIONS,
  AGENT_ADMIN_WRITE_OPERATIONS,
  CHAT_ADMIN_WRITE_OPERATIONS,
  isChatOnlyAdminWriteOperation,
} from "@/definition/AgentAdministration";

it("recognizes every chat-only administration write", () => {
  for (const operation of CHAT_ADMIN_WRITE_OPERATIONS)
    expect(isChatOnlyAdminWriteOperation(operation)).toBe(true);
});

it("keeps MCP operations and unknown input out of the chat-only set", () => {
  expect(isChatOnlyAdminWriteOperation(AGENT_ADMIN_WRITE_OPERATIONS[0])).toBe(
    false,
  );
  expect(isChatOnlyAdminWriteOperation(AGENT_ADMIN_READ_OPERATIONS[0])).toBe(
    false,
  );
  expect(isChatOnlyAdminWriteOperation(42)).toBe(false);
});
