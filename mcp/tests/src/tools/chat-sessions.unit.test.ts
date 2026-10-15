import { expect, it } from "vitest";

import {
  CHAT_SESSIONS_DELETE_TOOL,
  CHAT_SESSIONS_LIST_TOOL,
} from "../../../src/tools/chat-sessions.ts";
import { READ_TOOLS } from "../../../src/tools/registry.ts";
import { WRITE_TOOLS } from "../../../src/tools/write-registry.ts";

it("registers the own-session list and explicit deletion contracts", () => {
  expect(READ_TOOLS).toContainEqual({
    operation: "chat.sessions.list",
    tool: CHAT_SESSIONS_LIST_TOOL,
  });
  expect(WRITE_TOOLS).toContainEqual({
    operation: "chat.sessions.delete",
    tool: CHAT_SESSIONS_DELETE_TOOL,
  });
  expect(CHAT_SESSIONS_LIST_TOOL.inputSchema.additionalProperties).toBe(false);
  expect(CHAT_SESSIONS_DELETE_TOOL.inputSchema).toMatchObject({
    type: "object",
    additionalProperties: false,
    required: ["sessionIds", "expectedCount", "confirmation"],
    properties: {
      confirmation: { type: "string", enum: ["LÖSCHEN"] },
      expectedCount: { type: "integer", minimum: 1, maximum: 200 },
      sessionIds: {
        type: "array",
        minItems: 1,
        maxItems: 200,
        uniqueItems: true,
      },
    },
  });
  expect(CHAT_SESSIONS_DELETE_TOOL.description).toContain(
    "First call list_chat_sessions",
  );
  expect(CHAT_SESSIONS_DELETE_TOOL.annotations).toMatchObject({
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  });
});
