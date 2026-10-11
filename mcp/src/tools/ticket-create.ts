import type { Tool } from "@modelcontextprotocol/server";

/** Local, idempotent ticket creation with every choice stated; nothing is pushed by the call itself. */
export const TICKET_CREATE_TOOL: Tool = {
  name: "create_ticket",
  title: "Create ticket",
  description:
    "Creates one ticket in an explicit project, locally, without overwriting. type is initiative, epic, task or subtask; parentId is an ID, key or Pages address of a visible ticket of the right type in the same project, or null; statusId is a status ID from read_ticket statuses, or null for the status new tickets start in; milestoneId is a milestone ID of the project or null. Whether the ticket is published to GitHub follows the Pages setting of the project; the call never forces it. Reuse operationId with identical input to recover the same ticket after response loss; changed input returns CONFLICT. Without the write right the call returns FORBIDDEN. JSON request maximum 64 KiB.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: { type: "string", minLength: 1, maxLength: 200 },
      projectId: { type: "string", minLength: 1, maxLength: 200 },
      type: { enum: ["initiative", "epic", "task", "subtask"] },
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 65536 },
      statusId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      parentId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      milestoneId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
    },
    required: [
      "operationId",
      "projectId",
      "type",
      "title",
      "description",
      "statusId",
      "parentId",
      "milestoneId",
    ],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
