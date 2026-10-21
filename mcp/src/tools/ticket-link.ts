import {
  ADDITIVE_ANNOTATIONS,
  DESTRUCTIVE_ANNOTATIONS,
  IDENTIFIER_SCHEMA,
} from "./tool-definition.js";

import type { Tool } from "@modelcontextprotocol/server";

const COMMON =
  "ticketId and targetTicketId are ticket IDs, keys such as PAGE-12, or Pages addresses such as /tasks/PAGE-12. Only this link changes: neither parent, fields nor other links of the tickets. Reuse operationId with identical input to recover the stored result after response loss; changed input returns CONFLICT. A hidden or missing ticket returns NOT_FOUND alike; without the write right the call returns FORBIDDEN. Whether a ticket is published to GitHub is not affected: links are Pages-only. JSON request maximum 64 KiB.";

/** Adds one typed link from a ticket to another. */
export const TICKET_LINK_ADD_TOOL: Tool = {
  name: "add_ticket_link",
  title: "Add ticket link",
  description: `Links ticketId to targetTicketId: blocks (ticketId blocks the target), duplicates (ticketId duplicates the target) or relates_to (no direction). Read the existing links first with read_ticket_links; the link then shows on both tickets with the same id. The result has linkId, linkType, direction (outgoing), both tickets and removed:false. A link to the ticket itself or to an archived ticket returns INVALID_REQUEST; a link that already exists (relates_to also from the other side) returns CONFLICT and nothing is written. Moving a ticket below another parent is a separate change: set_ticket_parent. ${COMMON}`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER_SCHEMA,
      ticketId: IDENTIFIER_SCHEMA,
      targetTicketId: IDENTIFIER_SCHEMA,
      linkType: {
        type: "string",
        enum: ["blocks", "relates_to", "duplicates"],
      },
    },
    required: ["operationId", "ticketId", "targetTicketId", "linkType"],
  },
  annotations: ADDITIVE_ANNOTATIONS,
};

/** Removes one typed link of a ticket. */
export const TICKET_LINK_REMOVE_TOOL: Tool = {
  name: "remove_ticket_link",
  title: "Remove ticket link",
  description: `Removes the link linkId (an id from read_ticket_links) of ticketId, from either side of the link. The result names the link and both tickets with removed:true. A link that does not exist, belongs to other tickets or whose other ticket you cannot see returns NOT_FOUND. ${COMMON}`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER_SCHEMA,
      ticketId: IDENTIFIER_SCHEMA,
      linkId: IDENTIFIER_SCHEMA,
    },
    required: ["operationId", "ticketId", "linkId"],
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
};
