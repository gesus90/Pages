import { pageAgentEntries } from "@/backend/service/agents/AgentCursor";
import { CAPABILITY } from "@/definition/Authorization";

import { sortedIds } from "./McpUserSession";

import type { AdministrationActivity } from "@/definition/AgentAdministration";
import type {
  Department,
  ManagedUser,
  UserRole,
} from "@/definition/Authorization";
import type { UserGroup } from "@/definition/UserGroup";
import type {
  McpDepartment,
  McpGroup,
  McpRole,
  McpUser,
  McpUserActivity,
} from "./McpUserContract";
import type { McpUserListRequest } from "./McpUserRequest";
import type { McpUserSession } from "./McpUserSession";

/** One page of entries with the size of the whole filtered list. */
export interface McpUserListPage<Entry> {
  readonly entries: readonly Entry[];
  readonly total: number;
  readonly nextCursor: string | null;
}

/** What a page is cut from. */
interface McpUserListWindow {
  readonly session: McpUserSession;
  readonly list: string;
  readonly request: McpUserListRequest;
  /** Further filters of the list, which bind the cursor too. */
  readonly filters?: unknown;
  /** Keeps the order of the source, such as newest first. */
  readonly preserveOrder?: boolean;
}

/**
 * Cuts one page out of a list that is already filtered by the policy.
 *
 * @param entries - The visible entries only, so `total` counts nothing hidden.
 * @param window - The list, the query and the session.
 * @returns The page and an opaque cursor bound to the actor, the list, the
 * query and the actor's current rights.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a cursor of another
 * actor, query or rights state.
 */
export function pageMcpUserList<Entry extends { readonly id: string }>(
  entries: readonly Entry[],
  window: McpUserListWindow,
): McpUserListPage<Entry> {
  const { session, request } = window;
  return pageAgentEntries(entries, {
    cursor: request.cursor,
    limit: request.limit,
    preserveOrder: window.preserveOrder,
    context: JSON.stringify([
      "mcp.users.v1",
      session.actor.userId,
      window.list,
      request.text ?? "",
      window.filters ?? null,
      session.rightsFingerprint(),
    ]),
  });
}

/** Whether a search text matches one of the given texts, ignoring case. */
export function matchesMcpUserText(
  text: string | undefined,
  candidates: readonly (string | null)[],
): boolean {
  const wanted = text?.trim().toLowerCase() ?? "";
  if (wanted === "") return true;
  return candidates.some(
    (candidate) => candidate?.toLowerCase().includes(wanted) ?? false,
  );
}

/**
 * Shows an account of the user management.
 *
 * @param session - The request.
 * @param user - The row of the user management with its policy hints.
 * @param groups - The groups the actor sees.
 */
export function projectMcpUser(
  session: McpUserSession,
  user: ManagedUser,
  groups: readonly UserGroup[],
): McpUser {
  const { account } = user;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    firstName: account.firstName,
    lastName: account.lastName,
    email: user.email,
    isActive: user.isActive,
    isAdmin: account.isAdmin,
    isAgent: account.isAgent === true,
    roleId: account.role?.id ?? null,
    departmentIds: sortedIds(account.departments),
    groupIds: sortedIds(
      groups
        .filter((group) => group.memberIds.includes(user.id))
        .map((group) => group.id),
    ),
    scope: {
      managedDepartments: sortedIds(account.managedDepartments),
      allDepartments: account.allDepartments,
      allProjects: account.allProjects,
    },
    allowedActions: {
      canEditProfile: user.canEditProfile,
      canManageAccess: user.canManageAccess,
      canAssignRole: session.policy.canChange(
        session.actor,
        account,
        CAPABILITY.MANAGE_ROLES,
      ),
      canManageMemberships: user.canManageMemberships,
      canManageScope: user.canManageScope,
      canSetAdministrator: session.isAdministrator,
    },
  };
}

/** The stored fields of a role, permissions in a fixed order. */
export function mcpRoleFields(role: UserRole): {
  readonly name: string;
  readonly rank: number;
  readonly departmentBound: boolean;
  readonly permissions: UserRole["permissions"];
} {
  return {
    name: role.name,
    rank: role.rank,
    departmentBound: role.departmentBound,
    permissions: [...role.permissions].sort(),
  };
}

/** Shows a role of the role catalog. */
export function projectMcpRole(
  session: McpUserSession,
  role: UserRole,
): McpRole {
  return {
    id: role.id,
    ...mcpRoleFields(role),
    holderIds: session.visibleIds(session.holders(role.id)),
    canEdit: session.canEditRole(role),
  };
}

/** Shows a department with its visible members. */
export function projectMcpDepartment(
  session: McpUserSession,
  department: Department,
): McpDepartment {
  return {
    id: department.id,
    name: department.name,
    memberIds: session.visibleIds(session.departmentMembers(department.id)),
    canManage: session.policy.canManageDepartment(session.actor, department.id),
  };
}

/** Shows a group with its visible members. */
export function projectMcpGroup(
  session: McpUserSession,
  group: UserGroup,
): McpGroup {
  return {
    id: group.id,
    name: group.name,
    memberIds: session.visibleIds(session.groupMembers(group)),
    canEdit: session.canChangeGroup(group),
  };
}

/** Reads the affected people from the stored public result of an activity. */
function affectedOf(changes: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(changes);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("affectedUserIds" in parsed) ||
      !Array.isArray(parsed.affectedUserIds)
    )
      return [];
    return parsed.affectedUserIds.filter(
      (id: unknown): id is string => typeof id === "string",
    );
  } catch {
    return [];
  }
}

/** Shows one line of the administration history without its raw JSON. */
export function projectMcpActivity(
  activity: AdministrationActivity,
): McpUserActivity {
  return {
    id: activity.id,
    actorId: activity.actorId,
    operation: activity.operation,
    source: activity.source,
    targetType: activity.targetType,
    targetId: activity.targetId,
    affectedUserIds: affectedOf(activity.changes),
    createdAt: activity.createdAt,
  };
}
