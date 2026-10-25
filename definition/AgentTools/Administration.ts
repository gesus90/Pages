import { CAPABILITY } from "../Authorization.js";
import {
  CONFIRMATION_SCHEMA,
  IDENTIFIER_SCHEMA,
  NULLABLE_IDENTIFIER_SCHEMA,
  PAGING_PROPERTIES,
  buildReadTool,
  buildWriteTool,
} from "./ToolDefinition.js";

import type { PropertySchema } from "./ToolDefinition.js";
import type { Tool } from "@modelcontextprotocol/server";
import type {
  AGENT_ADMIN_WRITE_OPERATIONS,
  AgentAdminReadOperation,
} from "../AgentAdministration.js";

type McpAdminWriteOperation = (typeof AGENT_ADMIN_WRITE_OPERATIONS)[number];

const IDENTIFIERS: PropertySchema = {
  type: "array",
  items: IDENTIFIER_SCHEMA,
  maxItems: 100,
  uniqueItems: true,
};
const PERMISSIONS: PropertySchema = {
  type: "array",
  items: { type: "string", enum: Object.values(CAPABILITY) },
  maxItems: 7,
  uniqueItems: true,
};
const SCOPE: PropertySchema = {
  type: "object",
  properties: {
    managedDepartments: IDENTIFIERS,
    allDepartments: { type: "boolean" },
    allProjects: { type: "boolean" },
  },
  required: ["managedDepartments", "allDepartments", "allProjects"],
  additionalProperties: false,
};

const ADMIN_RIGHTS_DESCRIPTION =
  "Pages requires current personal administrator eligibility on every call, regardless of UI role mode.";
const ADMIN_WRITE_DESCRIPTION = `${ADMIN_RIGHTS_DESCRIPTION} Only existing targets can be changed. Reuse operationId with identical parameters after response loss. Pass the last read expected fields; stale state returns CONFLICT. Removing rights or memberships requires asking the user to type LÖSCHEN (German) or DELETE (English), then passing that exact reply as confirmation. Never infer confirmation. Successful changes are audited with source=mcp.`;
const ADMIN_READ_DESCRIPTION = `${ADMIN_RIGHTS_DESCRIPTION} Lists are cursor-paged (limit 1–100); continue the same query with nextCursor. No credentials, password hashes or email addresses are returned.`;

/** Administrative reads; normal directory tools retain their existing visibility rules. */
export const ADMIN_READ_TOOLS: readonly {
  readonly operation: AgentAdminReadOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "admin.users.list",
    tool: buildReadTool({
      name: "list_admin_users",
      title: "List admin users",
      description: `Lists all accounts, their normal roles, admin eligibility, activity, departments, groups and management scope. ${ADMIN_READ_DESCRIPTION}`,
      properties: { ...PAGING_PROPERTIES },
      required: [],
    }),
  },
  {
    operation: "admin.departments.list",
    tool: buildReadTool({
      name: "list_admin_departments",
      title: "List admin departments",
      description: `Lists existing departments and their member IDs. ${ADMIN_READ_DESCRIPTION}`,
      properties: { ...PAGING_PROPERTIES },
      required: [],
    }),
  },
  {
    operation: "admin.groups.list",
    tool: buildReadTool({
      name: "list_admin_groups",
      title: "List admin groups",
      description: `Lists existing groups and their member IDs. ${ADMIN_READ_DESCRIPTION}`,
      properties: { ...PAGING_PROPERTIES },
      required: [],
    }),
  },
  {
    operation: "admin.roles.list",
    tool: buildReadTool({
      name: "list_admin_roles",
      title: "List admin roles",
      description: `Lists reusable normal roles, ranks, department bindings and configurable permissions. A normal role never confers personal admin eligibility. ${ADMIN_READ_DESCRIPTION}`,
      properties: { ...PAGING_PROPERTIES },
      required: [],
    }),
  },
  {
    operation: "admin.permissions.list",
    tool: buildReadTool({
      name: "list_admin_permissions",
      title: "List admin permissions",
      description: `Reads the configurable permission catalog; reading is an immutable basic right. ${ADMIN_READ_DESCRIPTION}`,
      properties: { ...PAGING_PROPERTIES },
      required: [],
    }),
  },
  {
    operation: "admin.projectMembers.read",
    tool: buildReadTool({
      name: "read_admin_project_members",
      title: "Read admin project members",
      description: `Reads the members and departments of a project. ${ADMIN_READ_DESCRIPTION}`,
      properties: { projectId: IDENTIFIER_SCHEMA, ...PAGING_PROPERTIES },
      required: ["projectId"],
    }),
  },
  {
    operation: "admin.activity.read",
    tool: buildReadTool({
      name: "read_admin_activity",
      title: "Read admin activity",
      description: `Reads the administration audit trail, actor, target, affected people, time and source (mcp or ai). ${ADMIN_READ_DESCRIPTION}`,
      properties: { ...PAGING_PROPERTIES },
      required: [],
    }),
  },
];

/** MCP can change existing normal roles and memberships but cannot create users or administrators. */
export const ADMIN_WRITE_TOOLS: readonly {
  readonly operation: McpAdminWriteOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "admin.roles.setPermissions",
    tool: buildWriteTool({
      name: "set_admin_role_permissions",
      title: "Set admin role permissions",
      description: `Replaces the permission set of an existing normal role for ALL its current holders, preserving name, rank and department binding. Admin eligibility cannot be granted or revoked. ${ADMIN_WRITE_DESCRIPTION}`,
      properties: {
        ...{
          roleId: IDENTIFIER_SCHEMA,
          permissions: PERMISSIONS,
          expectedPermissions: PERMISSIONS,
        },
        confirmation: CONFIRMATION_SCHEMA,
      },
      optionalKeys: ["confirmation"],
      isDestructive: true,
    }),
  },
  {
    operation: "admin.roles.assign",
    tool: buildWriteTool({
      name: "assign_admin_role",
      title: "Assign admin role",
      description: `Assigns an existing normal role to a person or atomically to ALL CURRENT members of a group or department. This replaces each person's normal role, does not create inheritance, and does not affect future members. Read users and memberships first; expectedAssignments must name exactly every current target and their last-read role. Maximum 100 people per call. Personal admin eligibility is preserved. ${ADMIN_WRITE_DESCRIPTION}`,
      properties: {
        ...{
          targetType: {
            type: "string",
            enum: ["person", "group", "department"],
          },
          targetId: IDENTIFIER_SCHEMA,
          roleId: IDENTIFIER_SCHEMA,
          expectedAssignments: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              properties: {
                userId: IDENTIFIER_SCHEMA,
                roleId: NULLABLE_IDENTIFIER_SCHEMA,
              },
              required: ["userId", "roleId"],
              additionalProperties: false,
            },
          },
        },
        confirmation: CONFIRMATION_SCHEMA,
      },
      optionalKeys: ["confirmation"],
      isDestructive: true,
    }),
  },
  {
    operation: "admin.users.setName",
    tool: buildWriteTool({
      name: "set_admin_user_name",
      title: "Set admin user name",
      description: `Changes the name of an existing person while preserving login, email and authorization. ${ADMIN_WRITE_DESCRIPTION}`,
      properties: {
        ...{
          userId: IDENTIFIER_SCHEMA,
          firstName: { type: "string", maxLength: 200 },
          lastName: { type: "string", maxLength: 200 },
          expectedFirstName: { type: "string", maxLength: 200 },
          expectedLastName: { type: "string", maxLength: 200 },
        },
        confirmation: CONFIRMATION_SCHEMA,
      },
      optionalKeys: ["confirmation"],
      isDestructive: true,
    }),
  },
  {
    operation: "admin.users.setDepartments",
    tool: buildWriteTool({
      name: "set_admin_user_departments",
      title: "Set admin user departments",
      description: `Replaces an existing person's department memberships. The UI's final-membership rule still applies; removing membership requires confirmation. ${ADMIN_WRITE_DESCRIPTION}`,
      properties: {
        ...{
          userId: IDENTIFIER_SCHEMA,
          departmentIds: IDENTIFIERS,
          expectedDepartmentIds: IDENTIFIERS,
        },
        confirmation: CONFIRMATION_SCHEMA,
      },
      optionalKeys: ["confirmation"],
      isDestructive: true,
    }),
  },
  {
    operation: "admin.users.setScope",
    tool: buildWriteTool({
      name: "set_admin_user_scope",
      title: "Set admin user scope",
      description: `Sets explicit department/project management scope, preserving the person's normal role and administrator eligibility. Scope reductions require confirmation. ${ADMIN_WRITE_DESCRIPTION}`,
      properties: {
        ...{ userId: IDENTIFIER_SCHEMA, scope: SCOPE, expectedScope: SCOPE },
        confirmation: CONFIRMATION_SCHEMA,
      },
      optionalKeys: ["confirmation"],
      isDestructive: true,
    }),
  },
  {
    operation: "admin.groups.update",
    tool: buildWriteTool({
      name: "update_admin_group",
      title: "Update admin group",
      description: `Renames an existing group and replaces its members. New groups cannot be created. Removing members requires confirmation; members must be active and at least one must remain. ${ADMIN_WRITE_DESCRIPTION}`,
      properties: {
        ...{
          groupId: IDENTIFIER_SCHEMA,
          name: IDENTIFIER_SCHEMA,
          memberIds: IDENTIFIERS,
          expectedName: IDENTIFIER_SCHEMA,
          expectedMemberIds: IDENTIFIERS,
        },
        confirmation: CONFIRMATION_SCHEMA,
      },
      optionalKeys: ["confirmation"],
      isDestructive: true,
    }),
  },
  {
    operation: "admin.departments.rename",
    tool: buildWriteTool({
      name: "rename_admin_department",
      title: "Rename admin department",
      description: `Renames an existing department; it cannot create or delete a department. ${ADMIN_WRITE_DESCRIPTION}`,
      properties: {
        ...{
          departmentId: IDENTIFIER_SCHEMA,
          name: IDENTIFIER_SCHEMA,
          expectedName: IDENTIFIER_SCHEMA,
        },
        confirmation: CONFIRMATION_SCHEMA,
      },
      optionalKeys: ["confirmation"],
      isDestructive: true,
    }),
  },
];
