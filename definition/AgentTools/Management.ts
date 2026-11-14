import {
  ADDITIVE_ANNOTATIONS,
  IDENTIFIER_SCHEMA,
  PAGING_PROPERTIES,
  READ_ANNOTATIONS,
} from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";
import type { ManagementOperation } from "../Management.js";
import type { ToolProperties } from "./ToolDefinition.js";

const ids = { type: "array", items: IDENTIFIER_SCHEMA, maxItems: 100 } as const;
const revision = { type: "string", minLength: 1, maxLength: 200 } as const;
const agent = {
  type: "object",
  properties: {
    agentMd: { type: "string", maxLength: 100000 },
    soulMd: { type: "string", maxLength: 100000 },
    connectionId: IDENTIFIER_SCHEMA,
    model: IDENTIFIER_SCHEMA,
    reasoningEffort: { type: ["string", "null"] },
  },
  required: ["agentMd", "soulMd", "connectionId", "model", "reasoningEffort"],
  additionalProperties: false,
} satisfies ToolProperties;
const user = {
  displayName: IDENTIFIER_SCHEMA,
  email: { type: ["string", "null"] },
  role: IDENTIFIER_SCHEMA,
  departmentIds: ids,
  groupIds: ids,
  agent,
} satisfies ToolProperties;
const group = {
  name: IDENTIFIER_SCHEMA,
  description: { type: "string", maxLength: 5000 },
  memberIds: ids,
  leaderIds: ids,
} satisfies ToolProperties;
const operationId = { type: "string", format: "uuid" } as const;

function entry<Operation extends ManagementOperation>(
  operation: Operation,
  properties: ToolProperties,
  required: string[],
  isRead = false,
): { readonly operation: Operation; readonly tool: Tool } {
  return {
    operation,
    tool: {
      name: operation,
      title: operation.replaceAll("_", " "),
      description:
        "Business administration (PAGE-316). Same current permissions as the Pages interface. No credentials are returned; human invitations go only by email. Protected admin targets, role grants, own rights, core settings and YOLO are forbidden. Read the current revision before a mutation; CONFLICT reports currentRevision. Reuse operationId with identical input for a safe retry. Avatar requires expectedRevision, accepts at most 5 MiB decoded bytes, and SVG is rendered to PNG. Project revisions come from read_project; group revisions from the groups management view.",
      inputSchema: {
        type: "object",
        properties: isRead ? properties : { ...properties, operationId },
        required: isRead ? required : ["operationId", ...required],
        additionalProperties: false,
      },
      annotations: isRead ? READ_ANNOTATIONS : ADDITIVE_ANNOTATIONS,
    },
  };
}
/** Account directory tools offered through the same catalog as every existing Pages read. */
export const MANAGEMENT_READ_TOOLS = [
  entry("groups_read", { groupId: IDENTIFIER_SCHEMA }, ["groupId"], true),
  entry(
    "users_list",
    {
      ...PAGING_PROPERTIES,
      query: { type: "string" },
      kind: { type: "string", enum: ["agent", "human"] },
      status: { type: "string", enum: ["active", "deactivated"] },
      departmentId: IDENTIFIER_SCHEMA,
      groupId: IDENTIFIER_SCHEMA,
    },
    [],
    true,
  ),
  entry("users_read", { userId: IDENTIFIER_SCHEMA }, ["userId"], true),
];
/** Eight shared mutation tools; HTTP and pages-pica call exactly the same services. */
export const MANAGEMENT_WRITE_TOOLS = [
  entry(
    "users_create",
    {
      ...user,
      kind: { type: "string", enum: ["agent", "human"] },
      username: IDENTIFIER_SCHEMA,
    },
    ["kind", "displayName", "username", "role", "departmentIds", "groupIds"],
  ),
  entry(
    "users_update",
    { ...user, userId: IDENTIFIER_SCHEMA, expectedRevision: revision },
    ["userId", "expectedRevision"],
  ),
  entry(
    "users_set_status",
    {
      userId: IDENTIFIER_SCHEMA,
      expectedRevision: revision,
      status: { type: "string", enum: ["active", "deactivated"] },
    },
    ["userId", "expectedRevision", "status"],
  ),
  entry(
    "users_set_avatar",
    {
      userId: IDENTIFIER_SCHEMA,
      expectedRevision: revision,
      contentType: {
        type: "string",
        enum: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
      },
      dataBase64: { type: "string" },
    },
    ["userId", "expectedRevision", "contentType", "dataBase64"],
  ),
  entry("groups_create", group, [
    "name",
    "description",
    "memberIds",
    "leaderIds",
  ]),
  entry(
    "groups_update",
    { ...group, groupId: IDENTIFIER_SCHEMA, expectedRevision: revision },
    ["groupId", "expectedRevision"],
  ),
  entry(
    "project_members_set",
    {
      projectId: IDENTIFIER_SCHEMA,
      expectedRevision: revision,
      members: {
        type: "array",
        items: {
          type: "object",
          properties: {
            userId: IDENTIFIER_SCHEMA,
            role: {
              type: "string",
              enum: ["projectmanager", "member", "viewer"],
            },
          },
          required: ["userId", "role"],
          additionalProperties: false,
        },
      },
    },
    ["projectId", "expectedRevision", "members"],
  ),
  entry(
    "projects_set_departments",
    {
      projectId: IDENTIFIER_SCHEMA,
      expectedRevision: revision,
      departmentIds: ids,
    },
    ["projectId", "expectedRevision", "departmentIds"],
  ),
];
