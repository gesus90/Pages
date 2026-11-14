/** Business administration tools shared by the UI, paired clients and pages-pica. */
export const MANAGEMENT_READ_OPERATIONS = [
  "users_list",
  "users_read",
  "groups_read",
] as const;
/** Journaled business administration commands (PAGE-316). */
export const MANAGEMENT_WRITE_OPERATIONS = [
  "users_create",
  "users_update",
  "users_set_status",
  "users_set_avatar",
  "groups_create",
  "groups_update",
  "project_members_set",
  "projects_set_departments",
] as const;
/** Read operations of the business contract. */
export type ManagementReadOperation =
  (typeof MANAGEMENT_READ_OPERATIONS)[number];
/** Mutation operations of the business contract. */
export type ManagementWriteOperation =
  (typeof MANAGEMENT_WRITE_OPERATIONS)[number];
/** Every operation of the protected business administration contract. */
export type ManagementOperation =
  ManagementReadOperation | ManagementWriteOperation;
/** Public references never include account credentials. */
export interface ManagementReference {
  readonly id: string;
  readonly name: string;
}
/** A directory row with all of its organizational memberships. */
export interface ManagementUserRow {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly kind: "agent" | "human";
  readonly role: string | null;
  readonly status: "active" | "deactivated";
  readonly departments: readonly ManagementReference[];
  readonly groups: readonly ManagementReference[];
}
/** Editable agent documents and a selection from the released model catalog. */
export interface ManagementAgent {
  readonly agentMd: string;
  readonly soulMd: string;
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly avatarUrl?: string | null;
}
/** Validated directory filters and paging, shared by the interface contract. */
export interface ManagementUserQuery {
  readonly query?: string;
  readonly kind?: "agent" | "human";
  readonly status?: "active" | "deactivated";
  readonly departmentId?: string;
  readonly groupId?: string;
  readonly cursor?: string | null;
  readonly limit: number;
}
/** Complete safe account detail; revision covers memberships and agent configuration too. */
export interface ManagementUser extends ManagementUserRow {
  readonly email: string | null;
  readonly projects: readonly (ManagementReference & {
    readonly role: string;
  })[];
  readonly revision: string;
  readonly agent: ManagementAgent | null;
}
/** Group read companion supplies the revision needed by groups_update. */
export interface ManagementGroup {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly memberIds: readonly string[];
  readonly leaderIds?: readonly string[];
  readonly revision: string;
}
/** Safe results of the business administration tools. */
export type ManagementResult =
  | ManagementUser
  | ManagementGroup
  | {
      readonly users: readonly ManagementUserRow[];
      readonly total: number;
      readonly nextCursor: string | null;
    }
  | {
      readonly id: string;
      readonly revision?: string;
      readonly status?: "active" | "deactivated";
      readonly avatarUrl?: string;
    }
  | { readonly projectId: string; readonly revision: string };
/** Reasons which callers can act on without receiving private diagnostics. */
export type ManagementForbiddenReason =
  | "core_system"
  | "admin_target"
  | "self_escalation"
  | "role_grant"
  | "access_level";
/** Interchangeable delivery boundary; invitations go only to their recipient. */
export interface AccountInvitationDelivery {
  send(invitation: {
    readonly email: string;
    readonly username: string;
    readonly temporaryPassword: string;
  }): Promise<void>;
}
