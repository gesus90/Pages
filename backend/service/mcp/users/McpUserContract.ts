import type { Capability } from "@/definition/Authorization";

/** The explicit management scope of an account; only administrators change it. */
export interface McpUserScope {
  readonly managedDepartments: readonly string[];
  readonly allDepartments: boolean;
  readonly allProjects: boolean;
}

/** What the caller may do with one account now, from the policy of the interface. */
export interface McpUserActions {
  /** Change username, first and last name and email (`manage_roles`, rank, range). */
  readonly canEditProfile: boolean;
  /** Activate, deactivate and reset the password (`manage_users`, rank, range). */
  readonly canManageAccess: boolean;
  /** Assign one of the assignable roles (`manage_roles`, rank, range). */
  readonly canAssignRole: boolean;
  /** Change the department memberships within the membership policy. */
  readonly canManageMemberships: boolean;
  /** Change the personal management scope; administrators only. */
  readonly canManageScope: boolean;
  /** Grant or revoke personal administrator eligibility; administrators only. */
  readonly canSetAdministrator: boolean;
}

/** An account of the user management (interface "Benutzerprofil"). */
export interface McpUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly firstName: string;
  readonly lastName: string;
  /** Only within the range in which the user management shows addresses. */
  readonly email: string | null;
  readonly isActive: boolean;
  readonly isAdmin: boolean;
  /** An agent account: listed like in the interface, managed in the agents tab. */
  readonly isAgent: boolean;
  readonly roleId: string | null;
  readonly departmentIds: readonly string[];
  /** Groups the caller may see that list the account. */
  readonly groupIds: readonly string[];
  readonly scope: McpUserScope;
  readonly allowedActions: McpUserActions;
}

/** A shared role (interface "Rolle"). */
export interface McpRole {
  readonly id: string;
  readonly name: string;
  readonly rank: number;
  readonly departmentBound: boolean;
  readonly permissions: readonly Capability[];
  /** Visible accounts holding the role; a change applies to all holders. */
  readonly holderIds: readonly string[];
  /** Whether the caller may change or, unused, delete the role. */
  readonly canEdit: boolean;
}

/** A department (interface "Abteilung"). */
export interface McpDepartment {
  readonly id: string;
  readonly name: string;
  /** Visible accounts that are members of the department. */
  readonly memberIds: readonly string[];
  /** Whether the caller may rename or delete it. */
  readonly canManage: boolean;
}

/** A group (interface "Gruppe"). */
export interface McpGroup {
  readonly id: string;
  readonly name: string;
  /** Visible active members. */
  readonly memberIds: readonly string[];
  readonly canEdit: boolean;
}

/** A role, department or group as a choice. */
export interface McpUserChoice {
  readonly id: string;
  readonly name: string;
}

/** The permission catalog; it grants nothing by itself. */
export interface McpPermissionCatalog {
  readonly configurable: readonly Capability[];
  /** The basic right to read, which every account holds. */
  readonly read: true;
  readonly canDisableRead: false;
}

/** The answer of `GET /administration/options`. */
export interface McpUserManagementOptions {
  readonly permissions: McpPermissionCatalog;
  readonly assignableRoles: readonly (McpUserChoice & {
    readonly rank: number;
  })[];
  readonly editableRoleIds: readonly string[];
  readonly departments: readonly McpUserChoice[];
  readonly manageableDepartmentIds: readonly string[];
  /** Departments a new or departmentless account may join through the caller. */
  readonly adoptableDepartmentIds: readonly string[];
  readonly groups: readonly McpUserChoice[];
  readonly editableGroupIds: readonly string[];
  readonly actions: {
    readonly canCreateUsers: boolean;
    readonly canCreateAdministrators: boolean;
    readonly canManageRoles: boolean;
    readonly canManageDepartments: boolean;
    readonly canManageGroups: boolean;
    readonly canManageScopes: boolean;
    readonly canSetAdministrators: boolean;
    readonly canReadActivity: boolean;
    readonly canListPrivateWikiPages: boolean;
  };
  readonly confirmationWords: readonly string[];
}

/** One line of the administration history. */
export interface McpUserActivity {
  readonly id: string;
  readonly actorId: string;
  readonly operation: string;
  readonly source: "mcp" | "ai";
  readonly targetType: string;
  readonly targetId: string;
  readonly affectedUserIds: readonly string[];
  readonly createdAt: string;
}

/** A private wiki page of an account, as the user management shows it: no title, no text. */
export interface McpPrivateWikiPlaceholder {
  readonly id: string;
  readonly ownerId: string;
  readonly allowedActions: {
    /** Delete through `POST /wiki/pages/{id}/delete` with its confirmation. */
    readonly canDelete: boolean;
  };
}

/** The public result of a change; it never holds a secret. */
export interface McpUserChangeResult {
  readonly id: string;
  readonly targetType: "person" | "group" | "department" | "role";
  readonly changed: boolean;
  readonly affectedUserIds: readonly string[];
}

/** The answer of a change. */
export interface McpUserChangeResponse {
  readonly result: McpUserChangeResult;
  /** `true` when the operation ID was executed before and nothing ran again. */
  readonly replayed: boolean;
}

/** The answer of a creation or password reset. */
export interface McpUserCredentialResponse extends McpUserChangeResponse {
  readonly user: { readonly id: string; readonly username: string };
  /** Present only in the first answer; never stored, never repeated. */
  readonly temporaryPassword?: string;
  /**
   * `issued` in the first answer; `not_retrievable` for a repetition: the
   * password was issued once and cannot be read again. Whether it reached
   * anybody is unknown; a new reset needs a new operation ID.
   */
  readonly temporaryPasswordStatus: "issued" | "not_retrievable";
}

/** One page of a list. */
export interface McpUserPage {
  readonly total: number;
  readonly nextCursor: string | null;
}
