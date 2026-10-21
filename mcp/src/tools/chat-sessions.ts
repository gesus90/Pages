import {
  CHAT_CONFIRMATION_SCHEMA,
  READ_ANNOTATIONS,
  SESSION_DELETION_ANNOTATIONS,
} from "./tool-definition.js";

import type { Tool } from "@modelcontextprotocol/server";

/** All own Pica sessions; callers select explicit IDs before asking for confirmation. */
export const CHAT_SESSIONS_LIST_TOOL: Tool = {
  name: "list_chat_sessions",
  title: "List own Pica sessions",
  description:
    "Lists all Pica sessions of the connected account, with IDs, previews and total. Never lists another person's sessions, including for administrators. Before deletion show the selected sessions and count to the user and ask them to type LÖSCHEN.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: READ_ANNOTATIONS,
};

/** Counted, explicit session selection; no button-confirmation parameter exists in MCP. */
export const CHAT_SESSIONS_DELETE_TOOL: Tool = {
  name: "delete_chat_sessions",
  title: "Delete own Pica sessions",
  description:
    "Permanently deletes the explicitly selected own Pica sessions and their messages and attachments. First call list_chat_sessions, show the exact selection and count and require the user to type exactly LÖSCHEN (also in English). Pass that reply as confirmation. For all sessions use all listed IDs; process more than 200 in explicit batches and confirm the complete extent first. expectedCount must equal the number of unique sessionIds in this call. Ownership of every target is checked before any deletion; a foreign or missing target returns NOT_FOUND without deleting any. Result: deleted IDs, failed entries with sessionId/error and cleanupFailed IDs (session deleted, file cleanup failed). No automatic retry with a broader selection. UI confirmation never applies to MCP.",
  inputSchema: {
    type: "object",
    properties: {
      sessionIds: {
        type: "array",
        minItems: 1,
        maxItems: 200,
        uniqueItems: true,
        items: { type: "string", pattern: "^[a-z]{2,12}(?:-[a-z]{2,12}){4}$" },
      },
      expectedCount: { type: "integer", minimum: 1, maximum: 200 },
      confirmation: CHAT_CONFIRMATION_SCHEMA,
    },
    required: ["sessionIds", "expectedCount", "confirmation"],
    additionalProperties: false,
  },
  annotations: SESSION_DELETION_ANNOTATIONS,
};
