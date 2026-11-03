import { CAPABILITY } from "../Authorization.js";
import {
  IDENTIFIER_SCHEMA,
  NULLABLE_IDENTIFIER_SCHEMA,
  PAGING_PROPERTIES,
  buildReadTool,
  buildWriteTool,
} from "./ToolDefinition.js";
import { ADMIN_READ_TOOLS, ADMIN_WRITE_TOOLS } from "./Administration.js";

import type { PropertySchema } from "./ToolDefinition.js";
import type { Tool } from "@modelcontextprotocol/server";
import type {
  AGENT_ADMIN_WRITE_OPERATIONS,
  AgentAdminReadOperation,
  ChatAdminWriteOperation,
} from "../AgentAdministration.js";
import type {
  ChatInstanceOperation,
  ChatInstanceReadOperation,
  ChatInstanceWriteOperation,
} from "../ChatInstanceAdministration.js";

/** An administration operation of the chat with its contract. */
export interface ChatAdministrationTool {
  readonly operation:
    | AgentAdminReadOperation
    | (typeof AGENT_ADMIN_WRITE_OPERATIONS)[number]
    | Exclude<
        ChatAdminWriteOperation,
        "admin.users.create" | "admin.users.resetPassword"
      >
    | ChatInstanceOperation;
  readonly tool: Tool;
}

const IDENTIFIERS: PropertySchema = {
  type: "array",
  items: IDENTIFIER_SCHEMA,
  maxItems: 100,
  uniqueItems: true,
};
const ROLE: PropertySchema = {
  type: "object",
  properties: {
    id: IDENTIFIER_SCHEMA,
    name: { type: "string", minLength: 1, maxLength: 200 },
    rank: { type: "integer", minimum: 0 },
    departmentBound: { type: "boolean" },
    permissions: {
      type: "array",
      items: { type: "string", enum: Object.values(CAPABILITY) },
      maxItems: 7,
      uniqueItems: true,
    },
  },
  required: ["id", "name", "rank", "departmentBound", "permissions"],
  additionalProperties: false,
};
const NAME: PropertySchema = { type: "string", minLength: 1, maxLength: 200 };

const ONLY =
  "ADMIN ONLY: Pages checks the current administrator rights on every call.";
const READ =
  "Lists are cursor-paged (limit 1-100); continue with nextCursor. No credentials, password hashes or email addresses are returned.";
const WRITE =
  "Pass the values you read last as the expected fields; a stale state returns CONFLICT. Pages supplies operationId and the confirmation itself. When a change removes rights, memberships or access, Pages answers CONFIRMATION_REQUIRED: tell the person exactly what changes and ask them to reply with the confirmation word alone in a new message, then repeat the identical call. Never fabricate a confirmation.";

/** Descriptions for the chat; the MCP descriptions ask the client for a confirmation instead. */
const DESCRIPTIONS: Readonly<
  Record<ChatAdministrationTool["operation"], string>
> = {
  "admin.users.list": `Lists all accounts with their normal role, admin and active state, departments, groups and management scope. ${READ}`,
  "admin.departments.list": `Lists the departments with their member IDs. ${READ}`,
  "admin.groups.list": `Lists the groups with their member IDs. ${READ}`,
  "admin.roles.list": `Lists the normal roles with rank, department binding and permissions. ${READ}`,
  "admin.permissions.list": `Reads the catalog of configurable permissions; reading is always on. ${READ}`,
  "admin.projectMembers.read": `Reads the members and departments of a project. ${READ}`,
  "admin.activity.read": `Reads the administration audit trail with actor, target, time and source (mcp or ai). ${READ}`,
  "admin.connections.list": `Lists the agent connections with provider, state and whether a key exists; never the key. ${READ}`,
  "admin.settings.read":
    "Reads the company name of the instance and whether a logo exists.",
  "admin.roles.setPermissions": `Replaces the permissions of an existing normal role for ALL its holders. ${WRITE}`,
  "admin.roles.assign": `Assigns an existing normal role to a person or to ALL CURRENT members of a group or department (at most 100); expectedAssignments names every current target with its last-read role. ${WRITE}`,
  "admin.users.setName": `Changes the name of an existing person. ${WRITE}`,
  "admin.users.setDepartments": `Replaces the department memberships of an existing person. ${WRITE}`,
  "admin.users.setScope": `Sets the department and project management scope of a person. ${WRITE}`,
  "admin.groups.update": `Renames a group and replaces its members; members must be active and one must remain. ${WRITE}`,
  "admin.departments.rename": `Renames an existing department. ${WRITE}`,
  "admin.users.setAdministrator": `Grants or withdraws the administrator property of a person. Always needs the person's confirmation. ${WRITE}`,
  "admin.users.setActive": `Locks or unlocks an account. Always needs the person's confirmation. ${WRITE}`,
  "admin.groups.create": `Creates a group with at least one active member. ${WRITE}`,
  "admin.groups.delete": `Deletes a group; existing uses block it. Always needs the person's confirmation. ${WRITE}`,
  "admin.departments.create": `Creates a department. ${WRITE}`,
  "admin.departments.delete": `Deletes a department; existing uses block it. Always needs the person's confirmation. ${WRITE}`,
  "admin.roles.save": `Creates (expectedRole null) or changes a normal role; choose the new role ID explicitly. ${WRITE}`,
  "admin.roles.delete": `Deletes an unused normal role. Always needs the person's confirmation. ${WRITE}`,
  "admin.connections.setActive": `Enables or disables one agent connection without touching its credentials. Always needs the person's confirmation. ${WRITE}`,
  "admin.settings.setCompanyName": `Changes the company name of the instance. ${WRITE}`,
};

const READ_ENTRIES: readonly {
  readonly operation: ChatInstanceReadOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "admin.connections.list",
    tool: buildReadTool({
      name: "list_admin_connections",
      title: "List admin connections",
      description: DESCRIPTIONS["admin.connections.list"],
      properties: { ...PAGING_PROPERTIES },
      required: [],
    }),
  },
  {
    operation: "admin.settings.read",
    tool: buildReadTool({
      name: "read_admin_settings",
      title: "Read admin settings",
      description: DESCRIPTIONS["admin.settings.read"],
      properties: {},
      required: [],
    }),
  },
];

interface ChatOnlyWrite {
  readonly operation:
    | ChatInstanceWriteOperation
    | Exclude<
        ChatAdminWriteOperation,
        "admin.users.create" | "admin.users.resetPassword"
      >;
  readonly name: string;
  readonly title: string;
  readonly properties: Readonly<Record<string, PropertySchema>>;
}

const BOOLEAN: PropertySchema = { type: "boolean" };

const CHAT_ONLY_WRITES: readonly ChatOnlyWrite[] = [
  {
    operation: "admin.users.setAdministrator",
    name: "set_admin_user_administrator",
    title: "Set admin user administrator",
    properties: {
      userId: IDENTIFIER_SCHEMA,
      isAdmin: BOOLEAN,
      expectedIsAdmin: BOOLEAN,
    },
  },
  {
    operation: "admin.users.setActive",
    name: "set_admin_user_active",
    title: "Set admin user active",
    properties: {
      userId: IDENTIFIER_SCHEMA,
      isActive: BOOLEAN,
      expectedIsActive: BOOLEAN,
    },
  },
  {
    operation: "admin.groups.create",
    name: "create_admin_group",
    title: "Create admin group",
    properties: { name: NAME, memberIds: IDENTIFIERS },
  },
  {
    operation: "admin.groups.delete",
    name: "delete_admin_group",
    title: "Delete admin group",
    properties: {
      groupId: IDENTIFIER_SCHEMA,
      expectedName: NAME,
      expectedMemberIds: IDENTIFIERS,
    },
  },
  {
    operation: "admin.departments.create",
    name: "create_admin_department",
    title: "Create admin department",
    properties: { name: NAME },
  },
  {
    operation: "admin.departments.delete",
    name: "delete_admin_department",
    title: "Delete admin department",
    properties: {
      departmentId: IDENTIFIER_SCHEMA,
      expectedName: NAME,
      expectedMemberIds: IDENTIFIERS,
    },
  },
  {
    operation: "admin.roles.save",
    name: "save_admin_role",
    title: "Save admin role",
    properties: {
      role: ROLE,
      expectedRole: { anyOf: [ROLE, { type: "null" }] },
    },
  },
  {
    operation: "admin.roles.delete",
    name: "delete_admin_role",
    title: "Delete admin role",
    properties: { roleId: IDENTIFIER_SCHEMA, expectedRole: ROLE },
  },
  {
    operation: "admin.connections.setActive",
    name: "set_admin_connection_active",
    title: "Set admin connection active",
    properties: {
      connectionId: IDENTIFIER_SCHEMA,
      isActive: BOOLEAN,
      expectedIsActive: BOOLEAN,
    },
  },
  {
    operation: "admin.settings.setCompanyName",
    name: "set_admin_company_name",
    title: "Set admin company name",
    properties: {
      companyName: NAME,
      expectedCompanyName: NULLABLE_IDENTIFIER_SCHEMA,
    },
  },
];

function chatOnlyEntry(write: ChatOnlyWrite): ChatAdministrationTool {
  return {
    operation: write.operation,
    tool: buildWriteTool({
      name: write.name,
      title: write.title,
      description: DESCRIPTIONS[write.operation],
      properties: write.properties,
      isDestructive: true,
    }),
  };
}

/**
 * Every administration operation the chat offers an administrator.
 *
 * @remarks
 * The operations MCP already offers keep their contract and are only
 * described anew, because the chat never lets the model pass a confirmation.
 * Creating accounts and resetting passwords are left out: their one-time
 * password reaches only the person in the interface and has no path through
 * a tool result. The static list is shared by the native Pica tools.
 */
export const CHAT_ADMINISTRATION_TOOLS: readonly ChatAdministrationTool[] = [
  ...ADMIN_READ_TOOLS,
  ...ADMIN_WRITE_TOOLS,
  ...READ_ENTRIES,
  ...CHAT_ONLY_WRITES.map(chatOnlyEntry),
].map(({ operation, tool }): ChatAdministrationTool => ({
  operation,
  tool: { ...tool, description: `${ONLY} ${DESCRIPTIONS[operation]}` },
}));
