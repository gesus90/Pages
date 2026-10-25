import {
  DESTRUCTIVE_ANNOTATIONS,
  IDENTIFIER_SCHEMA,
  NULLABLE_IDENTIFIER_SCHEMA,
} from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";
import type { PropertySchema } from "./ToolDefinition.js";

const COMMON =
  "ticketId is a ticket ID, a key such as PAGE-12, or a Pages address such as /tasks/PAGE-12. The expected value is the one you read with read_ticket; if the field was saved with another value since then the call returns CONFLICT and nothing changes. Only this field changes; every other field and the position among the tickets stays as it is. Reuse operationId with identical input to recover the stored result after response loss; changed input returns CONFLICT. A hidden ticket returns NOT_FOUND; without the write right the call returns FORBIDDEN. Whether the change is published to GitHub follows the Pages setting of the project; the call never forces it. JSON request maximum 64 KiB.";

interface TicketFieldSpecification {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** The argument that carries the value that was read, and the one that carries the new value. */
  readonly expected: string;
  readonly value: string;
  readonly schema: PropertySchema;
}

function ticketFieldTool(specification: TicketFieldSpecification): Tool {
  return {
    name: specification.name,
    title: specification.title,
    description: `${specification.description} ${COMMON}`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        operationId: IDENTIFIER_SCHEMA,
        ticketId: IDENTIFIER_SCHEMA,
        [specification.expected]: specification.schema,
        [specification.value]: specification.schema,
      },
      required: [
        "operationId",
        "ticketId",
        specification.expected,
        specification.value,
      ],
    },
    annotations: DESTRUCTIVE_ANNOTATIONS,
  };
}

/** Changes only the title of one ticket. */
export const TICKET_SET_TITLE_TOOL: Tool = ticketFieldTool({
  name: "set_ticket_title",
  title: "Set ticket title",
  description:
    "Sets the title of one ticket; description, status, parent and milestone stay unchanged. The title is trimmed and must be 1 to 200 characters.",
  expected: "expectedTitle",
  value: "title",
  schema: IDENTIFIER_SCHEMA,
});

/** Changes only the description of one ticket. */
export const TICKET_SET_DESCRIPTION_TOOL: Tool = ticketFieldTool({
  name: "set_ticket_description",
  title: "Set ticket description",
  description:
    "Replaces the complete description of one ticket; title, status, parent and milestone stay unchanged. At most 65,536 characters.",
  expected: "expectedDescription",
  value: "description",
  schema: { type: "string", maxLength: 65536 },
});

/** Changes only the status of one ticket. */
export const TICKET_SET_STATUS_TOOL: Tool = ticketFieldTool({
  name: "set_ticket_status",
  title: "Set ticket status",
  description:
    "Moves one ticket to another status of its project (an ID from read_ticket statuses); title, description, parent and milestone stay unchanged, and no other ticket is touched. expectedStatusId is the statusId you read.",
  expected: "expectedStatusId",
  value: "statusId",
  schema: IDENTIFIER_SCHEMA,
});

/** Changes only the parent of one ticket. */
export const TICKET_SET_PARENT_TOOL: Tool = ticketFieldTool({
  name: "set_ticket_parent",
  title: "Set ticket parent",
  description:
    "Moves one ticket below another visible ticket of the same project (an ID, key or Pages address), or removes its parent with null. The parent must have the type the hierarchy requires: epics below initiatives, tasks below epics, subtasks below tasks. expectedParentId is the parentId you read (null when it had none). Title, description, status and milestone stay unchanged.",
  expected: "expectedParentId",
  value: "parentId",
  schema: NULLABLE_IDENTIFIER_SCHEMA,
});
