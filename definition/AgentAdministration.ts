import type {
  AccountAccess,
  Capability,
  Department,
  UserRole,
} from "./Authorization.js";
import type { AgentProjectMembers } from "./AgentExtensions.js";
import type { UserGroup } from "./UserGroup.js";

/** Administration reads, offered only to current personal administrators over MCP. */
export const AGENT_ADMIN_READ_OPERATIONS = [
  "admin.users.list",
  "admin.departments.list",
  "admin.groups.list",
  "admin.roles.list",
  "admin.permissions.list",
  "admin.projectMembers.read",
  "admin.activity.read",
] as const;

/** Mutations of existing records; personal admin eligibility is never changed over MCP. */
export const AGENT_ADMIN_WRITE_OPERATIONS = [
  "admin.roles.setPermissions",
  "admin.roles.assign",
  "admin.users.setName",
  "admin.users.setDepartments",
  "admin.users.setScope",
  "admin.groups.update",
  "admin.departments.rename",
] as const;

/** UI administration functions available only to the chat in active admin mode. */
export const CHAT_ADMIN_WRITE_OPERATIONS = [
  "admin.users.create",
  "admin.users.setAdministrator",
  "admin.users.setActive",
  "admin.users.resetPassword",
  "admin.groups.create",
  "admin.groups.delete",
  "admin.departments.create",
  "admin.departments.delete",
  "admin.roles.save",
  "admin.roles.delete",
] as const;

/** A read with the administrator boundary, including project-member reads. */
export type AgentAdminReadOperation =
  (typeof AGENT_ADMIN_READ_OPERATIONS)[number];
/** A UI administration write that MCP cannot invoke. */
export type ChatAdminWriteOperation =
  (typeof CHAT_ADMIN_WRITE_OPERATIONS)[number];

/** Narrows only the chat-specific additions to the administration catalog. */
export function isChatOnlyAdminWriteOperation(
  input: unknown,
): input is ChatAdminWriteOperation {
  return CHAT_ADMIN_WRITE_OPERATIONS.some((operation) => operation === input);
}
/** A mutation accepted by MCP or the administrator chat. */
export type AgentAdminWriteOperation =
  (typeof AGENT_ADMIN_WRITE_OPERATIONS)[number] | ChatAdminWriteOperation;

/** Safe administrative identity; password hashes, addresses and credentials are omitted. */
export interface AgentAdminUser extends AccountAccess {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly groups: readonly { readonly id: string; readonly name: string }[];
}

/** Bounded administrative lists use the same owner/query-bound cursors as the other agent reads. */
export interface AgentAdminList<T> {
  readonly entries: readonly T[];
  readonly total: number;
  readonly nextCursor: string | null;
}

/** A durable administration change, recorded in the same transaction as its mutation. */
export interface AdministrationActivity {
  readonly id: string;
  readonly actorId: string;
  readonly operation: string;
  readonly source: "mcp" | "ai";
  readonly targetType: string;
  readonly targetId: string;
  /** JSON of the public result; never a password, token or operation's raw parameters. */
  readonly changes: string;
  readonly createdAt: string;
}

/** Administration results contain only the explicit safe catalog contracts. */
export type AgentAdminReadResult =
  | AgentAdminList<AgentAdminUser>
  | AgentAdminList<Department & { readonly memberIds: readonly string[] }>
  | AgentAdminList<UserGroup>
  | AgentAdminList<UserRole>
  | AgentAdminList<AdministrationActivity>
  | AgentProjectMembers
  | {
      readonly permissions: readonly Capability[];
      readonly read: true;
      readonly canDisableRead: false;
    };

/** Public idempotent result of a completed administration action. */
export interface AgentAdminChanged {
  readonly id: string;
  readonly targetType: "person" | "group" | "department" | "role";
  readonly changed: boolean;
  readonly affectedUserIds: readonly string[];
}

/** A one-time password delivered directly to the signed-in administrator, outside model prompts and chat history. */
export interface ChatTemporaryPassword {
  readonly userId: string;
  readonly username: string;
  readonly temporaryPassword: string;
}

/** Private chat receipts are never saved in replay records or returned on the MCP channel. */
export interface AgentAdminWriteResponse {
  readonly apiVersion: "1";
  readonly result: AgentAdminChanged;
  readonly temporaryPassword?: ChatTemporaryPassword;
}
