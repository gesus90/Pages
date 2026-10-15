import type { Tool } from "@modelcontextprotocol/server";

const IDENTIFIER = { type: "string", minLength: 1, maxLength: 200 } as const;
const TICKET =
  "ticketId is a ticket ID, a key such as PAGE-12, or a Pages address such as /tasks/PAGE-12.";

/** Reads the checklist of one ticket as structured entries. */
export const TICKET_CHECKLIST_READ_TOOL: Tool = {
  name: "read_ticket_checklist",
  title: "Read ticket checklist",
  description: `Reads every checkbox of a visible ticket: the acceptance criteria (source "criteria") and the task list items of the Markdown description (source "description"; code blocks never count). Each entry has a stable id, its text, checked true or false, its order, its nesting depth and parentId. Equal texts get different ids. One call returns the complete checklist; no entry needs a separate read. revision changes whenever the description or a criterion changes; pass it to set_ticket_checklist_item, or to set_ticket_checklist_items to set several entries at once from this list. ${TICKET} Missing and hidden tickets both return NOT_FOUND. Responses are limited to 1 MiB UTF-8 JSON.`,
  inputSchema: {
    type: "object",
    properties: { ticketId: IDENTIFIER },
    required: ["ticketId"],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/** Sets one checklist entry of one ticket to an explicit state. */
export const TICKET_CHECKLIST_SET_TOOL: Tool = {
  name: "set_ticket_checklist_item",
  title: "Set ticket checklist item",
  description: `Sets one checklist entry (an id from read_ticket_checklist) to checked true or false; it never toggles, and an entry that already has the state stays unchanged with changed false. Only this entry changes: for a description entry only the character inside its brackets, every other character of the description stays as it is. expectedRevision is the revision you read; if anything in the checklist changed since then the call returns CONFLICT and nothing changes, so read again. An unknown or removed id returns NOT_FOUND. The result carries the new revision for the next change. Reuse operationId with identical input to recover the stored result after response loss; changed input returns CONFLICT. ${TICKET} A hidden ticket returns NOT_FOUND; without the write right the call returns FORBIDDEN. JSON request maximum 64 KiB.`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER,
      ticketId: IDENTIFIER,
      itemId: IDENTIFIER,
      checked: { type: "boolean" },
      expectedRevision: IDENTIFIER,
    },
    required: [
      "operationId",
      "ticketId",
      "itemId",
      "checked",
      "expectedRevision",
    ],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/** Sets several checklist entries of one ticket to explicit states in one atomic call. */
export const TICKET_CHECKLIST_SET_ITEMS_TOOL: Tool = {
  name: "set_ticket_checklist_items",
  title: "Set ticket checklist items",
  description: `Sets several checklist entries (ids from read_ticket_checklist) to checked true or false with one call; it never toggles. Pass the revision you read as expectedRevision and the entries as items: [{itemId, checked}]; the items of read_ticket_checklist reduce to these two fields. Only the named entries change: entries you leave out, every text and every other field of the ticket stay as they are, and for a description entry only the character inside its brackets changes. The whole request is validated first and applied atomically: either every named entry has its state or nothing changes. An entry that already has the state stays unchanged; changedCount tells how many entries were written, and 0 writes nothing and keeps the revision. The result is the complete checklist after the call as read_ticket_checklist returns it, with the new revision and changedCount, so the next change needs no new read. Errors: INVALID_REQUEST with details.reason checklist_items_invalid (items is not a list of 1 to 500 objects {itemId, checked} with a boolean checked), checklist_item_duplicate (an itemId is named twice) or checklist_item_unknown (an itemId is not in the checklist at expectedRevision); CONFLICT when anything in the checklist changed since expectedRevision (nothing is written, so read again); NOT_FOUND for a hidden ticket; FORBIDDEN without the write right. Reuse operationId with identical input to recover the stored result after response loss; changed input returns CONFLICT. ${TICKET} JSON request maximum 64 KiB.`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER,
      ticketId: IDENTIFIER,
      expectedRevision: IDENTIFIER,
      items: {
        type: "array",
        minItems: 1,
        maxItems: 500,
        items: {
          type: "object",
          additionalProperties: false,
          properties: { itemId: IDENTIFIER, checked: { type: "boolean" } },
          required: ["itemId", "checked"],
        },
      },
    },
    required: ["operationId", "ticketId", "expectedRevision", "items"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
