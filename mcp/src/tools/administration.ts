import { CAPABILITY } from "../../../definition/Authorization.js";

import type { Tool } from "@modelcontextprotocol/server";
import type {
  AgentAdminReadOperation,
  AGENT_ADMIN_WRITE_OPERATIONS,
} from "../../../definition/AgentAdministration.js";

type Properties = NonNullable<Tool["inputSchema"]["properties"]>;
type FieldSchema = Properties[string];
type McpAdminWriteOperation = (typeof AGENT_ADMIN_WRITE_OPERATIONS)[number];

const IDENTIFIER: FieldSchema = {
  type: "string",
  minLength: 1,
  maxLength: 200,
};
const IDENTIFIERS: FieldSchema = {
  type: "array",
  items: IDENTIFIER,
  maxItems: 100,
  uniqueItems: true,
};
const PERMISSIONS: FieldSchema = {
  type: "array",
  items: { type: "string", enum: Object.values(CAPABILITY) },
  maxItems: 7,
  uniqueItems: true,
};
const SCOPE: FieldSchema = {
  type: "object",
  properties: {
    managedDepartments: IDENTIFIERS,
    allDepartments: { type: "boolean" },
    allProjects: { type: "boolean" },
  },
  required: ["managedDepartments", "allDepartments", "allProjects"],
  additionalProperties: false,
};

function adminTool(
  name: string,
  summary: string,
  properties: Properties,
  isWrite = false,
): Tool {
  return {
    name,
    description: `${summary} Pages requires current personal administrator eligibility on every call, regardless of UI role mode. ${
      isWrite
        ? "Only existing targets can be changed. Reuse operationId with identical parameters after response loss. Pass the last read expected fields; stale state returns CONFLICT. Removing rights or memberships requires asking the user to type LÖSCHEN (German) or DELETE (English), then passing that exact reply as confirmation. Never infer confirmation. Successful changes are audited with source=mcp."
        : "Lists are cursor-paged (limit 1–100); continue the same query with nextCursor. No credentials, password hashes or email addresses are returned."
    }`,
    inputSchema: {
      type: "object",
      properties: {
        ...properties,
        ...(isWrite
          ? {
              operationId: IDENTIFIER,
              confirmation: { type: "string", enum: ["LÖSCHEN", "DELETE"] },
            }
          : {
              cursor: { type: ["string", "null"], maxLength: 2048 },
              limit: { type: "integer", minimum: 1, maximum: 100 },
            }),
      },
      required: [
        ...Object.keys(properties),
        ...(isWrite ? ["operationId"] : []),
      ],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: !isWrite,
      destructiveHint: isWrite,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

/** Administrative reads; normal directory tools retain their existing visibility rules. */
export const ADMIN_READ_TOOLS: readonly {
  readonly operation: AgentAdminReadOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "admin.users.list",
    tool: adminTool(
      "list_admin_users",
      "Lists all accounts, their normal roles, admin eligibility, activity, departments, groups and management scope.",
      {},
    ),
  },
  {
    operation: "admin.departments.list",
    tool: adminTool(
      "list_admin_departments",
      "Lists existing departments and their member IDs.",
      {},
    ),
  },
  {
    operation: "admin.groups.list",
    tool: adminTool(
      "list_admin_groups",
      "Lists existing groups and their member IDs.",
      {},
    ),
  },
  {
    operation: "admin.roles.list",
    tool: adminTool(
      "list_admin_roles",
      "Lists reusable normal roles, ranks, department bindings and configurable permissions. A normal role never confers personal admin eligibility.",
      {},
    ),
  },
  {
    operation: "admin.permissions.list",
    tool: adminTool(
      "list_admin_permissions",
      "Reads the configurable permission catalog; reading is an immutable basic right.",
      {},
    ),
  },
  {
    operation: "admin.projectMembers.read",
    tool: adminTool(
      "read_admin_project_members",
      "Reads the members and departments of a project.",
      { projectId: IDENTIFIER },
    ),
  },
  {
    operation: "admin.activity.read",
    tool: adminTool(
      "read_admin_activity",
      "Reads the administration audit trail, actor, target, affected people, time and source (mcp or ai).",
      {},
    ),
  },
];

/** MCP can change existing normal roles and memberships but cannot create users or administrators. */
export const ADMIN_WRITE_TOOLS: readonly {
  readonly operation: McpAdminWriteOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "admin.roles.setPermissions",
    tool: adminTool(
      "set_admin_role_permissions",
      "Replaces the permission set of an existing normal role for ALL its current holders, preserving name, rank and department binding. Admin eligibility cannot be granted or revoked.",
      {
        roleId: IDENTIFIER,
        permissions: PERMISSIONS,
        expectedPermissions: PERMISSIONS,
      },
      true,
    ),
  },
  {
    operation: "admin.roles.assign",
    tool: adminTool(
      "assign_admin_role",
      "Assigns an existing normal role to a person or atomically to ALL CURRENT members of a group or department. This replaces each person's normal role, does not create inheritance, and does not affect future members. Read users and memberships first; expectedAssignments must name exactly every current target and their last-read role. Maximum 100 people per call. Personal admin eligibility is preserved.",
      {
        targetType: { type: "string", enum: ["person", "group", "department"] },
        targetId: IDENTIFIER,
        roleId: IDENTIFIER,
        expectedAssignments: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              userId: IDENTIFIER,
              roleId: {
                type: ["string", "null"],
                minLength: 1,
                maxLength: 200,
              },
            },
            required: ["userId", "roleId"],
            additionalProperties: false,
          },
        },
      },
      true,
    ),
  },
  {
    operation: "admin.users.setName",
    tool: adminTool(
      "set_admin_user_name",
      "Changes the name of an existing person while preserving login, email and authorization.",
      {
        userId: IDENTIFIER,
        firstName: { type: "string", maxLength: 200 },
        lastName: { type: "string", maxLength: 200 },
        expectedFirstName: { type: "string", maxLength: 200 },
        expectedLastName: { type: "string", maxLength: 200 },
      },
      true,
    ),
  },
  {
    operation: "admin.users.setDepartments",
    tool: adminTool(
      "set_admin_user_departments",
      "Replaces an existing person's department memberships. The UI's final-membership rule still applies; removing membership requires confirmation.",
      {
        userId: IDENTIFIER,
        departmentIds: IDENTIFIERS,
        expectedDepartmentIds: IDENTIFIERS,
      },
      true,
    ),
  },
  {
    operation: "admin.users.setScope",
    tool: adminTool(
      "set_admin_user_scope",
      "Sets explicit department/project management scope, preserving the person's normal role and administrator eligibility. Scope reductions require confirmation.",
      { userId: IDENTIFIER, scope: SCOPE, expectedScope: SCOPE },
      true,
    ),
  },
  {
    operation: "admin.groups.update",
    tool: adminTool(
      "update_admin_group",
      "Renames an existing group and replaces its members. New groups cannot be created. Removing members requires confirmation; members must be active and at least one must remain.",
      {
        groupId: IDENTIFIER,
        name: IDENTIFIER,
        memberIds: IDENTIFIERS,
        expectedName: IDENTIFIER,
        expectedMemberIds: IDENTIFIERS,
      },
      true,
    ),
  },
  {
    operation: "admin.departments.rename",
    tool: adminTool(
      "rename_admin_department",
      "Renames an existing department; it cannot create or delete a department.",
      { departmentId: IDENTIFIER, name: IDENTIFIER, expectedName: IDENTIFIER },
      true,
    ),
  },
];
