import type { Tool } from "@modelcontextprotocol/server";

type FieldSchema = NonNullable<Tool["inputSchema"]["properties"]>[string];

const IDENTIFIER = { type: "string", minLength: 1, maxLength: 200 } as const;
const NULLABLE_IDENTIFIER: FieldSchema = {
  type: ["string", "null"],
  minLength: 1,
  maxLength: 200,
};

/** Local, idempotent ticket creation; what a call leaves open is taken from the parent and the account. */
export const TICKET_CREATE_TOOL: Tool = {
  name: "create_ticket",
  title: "Create ticket",
  description:
    "Creates one ticket, locally, without overwriting. type is initiative, epic, task or subtask; parentId is an ID, key or Pages address of a visible ticket of the right type in the same project, or null; statusId is a status ID from read_ticket statuses, or null for the status new tickets start in. What you leave out or pass as null is taken, never invented: projectId from the parent (a project that differs from the parent's returns INVALID_REQUEST; one of them is required); milestoneId and departmentId from the parent when it has one (a department only when you may select it); assignee is the person you are signed in as, as for the ticket pages. Values you give win over the parent: a milestoneId of the project, a departmentId from search_assignment_targets, and assignee {targetType: person|group, targetId} from search_assignment_targets, or {targetType: none, targetId: null} for nobody. A person who may not be assigned in the project returns INVALID_REQUEST; a person, group or department you cannot see returns NOT_FOUND; a visible department you may not select returns FORBIDDEN. A task that carries a milestone gives it to its epic when that has none, and links its initiative. Whether the ticket is published to GitHub follows the Pages setting of the project; the call never forces it. Reuse operationId with identical input to recover the same ticket after response loss; changed input returns CONFLICT. Without the write right the call returns FORBIDDEN. JSON request maximum 64 KiB.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER,
      projectId: NULLABLE_IDENTIFIER,
      type: { enum: ["initiative", "epic", "task", "subtask"] },
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 65536 },
      statusId: NULLABLE_IDENTIFIER,
      parentId: NULLABLE_IDENTIFIER,
      milestoneId: NULLABLE_IDENTIFIER,
      departmentId: NULLABLE_IDENTIFIER,
      assignee: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: {
          targetType: { type: "string", enum: ["person", "group", "none"] },
          targetId: NULLABLE_IDENTIFIER,
        },
        required: ["targetType", "targetId"],
      },
    },
    required: [
      "operationId",
      "type",
      "title",
      "description",
      "statusId",
      "parentId",
    ],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
