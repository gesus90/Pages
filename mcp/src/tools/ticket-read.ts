import type { Tool } from "@modelcontextprotocol/server";

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const IDENTIFIER = { type: "string", minLength: 1, maxLength: 200 } as const;

/** Reads one ticket with the values the single-field changes compare against. */
export const TICKET_READ_TOOL: Tool = {
  name: "read_ticket",
  title: "Read ticket",
  description:
    "Reads the core fields of a visible ticket: title, description, status, parent, milestone, dates, and the statuses its project offers (statuses[].id is what set_ticket_status takes). ticketId is a ticket ID, a key such as PAGE-12, or a Pages address such as /tasks/PAGE-12. A parent you cannot see is reported as null. Missing and hidden tickets both return NOT_FOUND. Responses are limited to 1 MiB UTF-8 JSON.",
  inputSchema: {
    type: "object",
    properties: { ticketId: IDENTIFIER },
    required: ["ticketId"],
    additionalProperties: false,
  },
  annotations: ANNOTATIONS,
};

/** Reads the milestones and dependencies of one project. */
export const MILESTONES_READ_TOOL: Tool = {
  name: "read_milestones",
  title: "Read milestones",
  description:
    "Lists the milestones (ID, name, description, status, start and due date) and the dependencies between them for a visible project. A hidden project returns NOT_FOUND. Responses are limited to 1 MiB UTF-8 JSON.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: IDENTIFIER,
      cursor: { type: ["string", "null"] },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  annotations: ANNOTATIONS,
};
