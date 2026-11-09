import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { CAPABILITY } from "@/definition/Authorization";

import {
  matchesMcpUserText,
  pageMcpUserList,
  projectMcpActivity,
  projectMcpDepartment,
  projectMcpGroup,
  projectMcpRole,
  projectMcpUser,
} from "./McpUserProjection";
import { McpUserError } from "./McpUserError";
import {
  MCP_USER_CONFIRMATION_WORDS,
  requireMcpUserRight,
} from "./McpUserSession";

import type { WikiService } from "@/backend/service/WikiService";
import type { User } from "@/definition/User";
import type {
  McpDepartment,
  McpGroup,
  McpPrivateWikiPlaceholder,
  McpRole,
  McpUser,
  McpUserActivity,
  McpUserManagementOptions,
  McpUserPage,
} from "./McpUserContract";
import type { McpUserListPage } from "./McpUserProjection";
import type {
  McpUserDirectoryRequest,
  McpUserListRequest,
} from "./McpUserRequest";
import type { McpUserSession } from "./McpUserSession";

/** A page of a list, its entries named by the list. */
type NamedPage<Name extends string, Entry> = McpUserPage &
  Readonly<Record<Name, readonly Entry[]>>;

/** Total and continuation of a page, without its entries. */
function pageInfo<Entry>(page: McpUserListPage<Entry>): McpUserPage {
  return { total: page.total, nextCursor: page.nextCursor };
}

/**
 * Whether the wiki shows the actor the private pages of other accounts.
 *
 * @remarks
 * The wiki keeps its own rule, like the user management page: an
 * administrator in the active admin mode. The MCP call does not switch the
 * mode and this ticket grants no further right.
 */
function canListPrivateWikiPages(session: McpUserSession): boolean {
  return new UserPolicyService("ui").isAdministrator(session.actor);
}

/**
 * The reads of the user management API (PAGE-280): options, accounts, roles,
 * departments, groups, the administration history and private wiki
 * placeholders.
 *
 * @remarks
 * Every list is filtered by the policy of the interface before it is paged
 * and counted, so neither an entry nor the number of hidden entries leaves
 * the server. A hidden object answers `not_found` like an unknown one.
 */
export class McpUserReadService {
  /**
   * Reads the choices and the actions the actor may take now.
   *
   * @param session - The request.
   * @throws {McpUserError} `forbidden` without access to the user management.
   */
  public async options(
    session: McpUserSession,
  ): Promise<McpUserManagementOptions> {
    session.requireManagement();
    const page = await session.administration.pageData(session.actor.userId);
    const groups = page.groups.groups;
    const { policy, actor, isAdministrator } = session;
    return {
      permissions: {
        configurable: Object.values(CAPABILITY),
        read: true,
        canDisableRead: false,
      },
      assignableRoles: page.assignableRoles.map((role) => ({
        id: role.id,
        name: role.name,
        rank: role.rank,
      })),
      editableRoleIds: page.editableRoleIds,
      departments: page.departments.map(({ id, name }) => ({ id, name })),
      manageableDepartmentIds: page.manageableDepartmentIds,
      adoptableDepartmentIds: page.adoptableDepartmentIds,
      groups: groups.map(({ id, name }) => ({ id, name })),
      editableGroupIds: groups
        .filter((group) => group.canEdit)
        .map((group) => group.id),
      actions: {
        canCreateUsers: page.canCreate,
        canCreateAdministrators: isAdministrator,
        canManageRoles: page.canManageRoles,
        canManageDepartments: page.canManageDepartments,
        canManageGroups: policy.canManageGroups(actor),
        canManageScopes: isAdministrator,
        canSetAdministrators: isAdministrator,
        canReadActivity: isAdministrator,
        canListPrivateWikiPages: canListPrivateWikiPages(session),
      },
      confirmationWords: MCP_USER_CONFIRMATION_WORDS,
    };
  }

  /**
   * Lists the accounts of the user management, active and inactive ones.
   *
   * @param session - The request.
   * @param request - Search text over display name, username and the shown
   * email address, the optional `isActive` filter and the page.
   */
  public async users(
    session: McpUserSession,
    request: McpUserDirectoryRequest,
  ): Promise<NamedPage<"users", McpUser>> {
    const users = await this.allUsers(session);
    const isActive =
      request.isActive === undefined ? null : request.isActive === "true";
    const filtered = users.filter(
      (user) =>
        (isActive === null || user.isActive === isActive) &&
        matchesMcpUserText(request.text, [
          user.displayName,
          user.username,
          user.email,
        ]),
    );
    const page = pageMcpUserList(filtered, {
      session,
      list: "users",
      request,
      filters: isActive,
    });
    return { users: page.entries, ...pageInfo(page) };
  }

  /**
   * Reads one account.
   *
   * @param session - The request.
   * @param userId - The account.
   * @throws {McpUserError} `not_found` for an unknown or hidden account.
   */
  public async user(
    session: McpUserSession,
    userId: string,
  ): Promise<{ readonly user: McpUser }> {
    const user = (await this.allUsers(session)).find(
      (candidate) => candidate.id === userId,
    );
    if (user === undefined) throw new McpUserError("not_found");
    return { user };
  }

  /** Lists the role catalog: the roles the actor may assign or edit. */
  public roles(
    session: McpUserSession,
    request: McpUserListRequest,
  ): NamedPage<"roles", McpRole> {
    session.requireManagement();
    const roles = session
      .visibleRoles()
      .filter((role) => matchesMcpUserText(request.text, [role.name]))
      .map((role) => projectMcpRole(session, role));
    const page = pageMcpUserList(roles, { session, list: "roles", request });
    return { roles: page.entries, ...pageInfo(page) };
  }

  /** Reads one role of the catalog. */
  public role(
    session: McpUserSession,
    roleId: string,
  ): { readonly role: McpRole } {
    session.requireManagement();
    return { role: projectMcpRole(session, session.visibleRole(roleId)) };
  }

  /** Lists the departments the user management shows the actor. */
  public departments(
    session: McpUserSession,
    request: McpUserListRequest,
  ): NamedPage<"departments", McpDepartment> {
    session.requireManagement();
    const departments = session
      .visibleDepartments()
      .filter((department) =>
        matchesMcpUserText(request.text, [department.name]),
      )
      .map((department) => projectMcpDepartment(session, department));
    const page = pageMcpUserList(departments, {
      session,
      list: "departments",
      request,
    });
    return { departments: page.entries, ...pageInfo(page) };
  }

  /** Reads one department. */
  public department(
    session: McpUserSession,
    departmentId: string,
  ): { readonly department: McpDepartment } {
    session.requireManagement();
    return {
      department: projectMcpDepartment(
        session,
        session.visibleDepartment(departmentId),
      ),
    };
  }

  /** Lists the groups the actor sees; empty without the right to manage groups. */
  public async groups(
    session: McpUserSession,
    request: McpUserListRequest,
  ): Promise<NamedPage<"groups", McpGroup>> {
    session.requireManagement();
    const groups = (await session.visibleGroups())
      .filter((group) => matchesMcpUserText(request.text, [group.name]))
      .map((group) => projectMcpGroup(session, group));
    const page = pageMcpUserList(groups, { session, list: "groups", request });
    return { groups: page.entries, ...pageInfo(page) };
  }

  /** Reads one group. */
  public async group(
    session: McpUserSession,
    groupId: string,
  ): Promise<{ readonly group: McpGroup }> {
    session.requireManagement();
    return {
      group: projectMcpGroup(session, await session.visibleGroup(groupId)),
    };
  }

  /**
   * Reads the administration history, newest first.
   *
   * @param session - The request.
   * @param request - Search text over operation, target and actor, and the page.
   * @throws {McpUserError} `forbidden` for anyone but an administrator; the
   * history is instance-wide and no project leader reads it.
   */
  public async activity(
    session: McpUserSession,
    request: McpUserListRequest,
  ): Promise<NamedPage<"activity", McpUserActivity>> {
    session.requireAdministrator();
    const entries = (
      await new AdministrationActivityRepository(session.database).findAll()
    )
      .map(projectMcpActivity)
      .filter((entry) =>
        matchesMcpUserText(request.text, [
          entry.operation,
          entry.targetType,
          entry.targetId,
          entry.actorId,
        ]),
      );
    const page = pageMcpUserList(entries, {
      session,
      list: "activity",
      request,
      preserveOrder: true,
    });
    return { activity: page.entries, ...pageInfo(page) };
  }

  /**
   * Lists the private wiki pages of an account as placeholders: identifier,
   * owner and the allowed action, never a title or text.
   *
   * @param session - The request.
   * @param context - The actor's account and the wiki service of the interface.
   * @param ownerId - The account whose private pages are listed.
   * @param request - The page.
   * @throws {McpUserError} `forbidden` unless the wiki shows the actor such placeholders.
   */
  public async privateWikiPages(
    session: McpUserSession,
    context: {
      readonly actor: User;
      readonly wiki: Pick<WikiService, "listPlaceholders">;
    },
    ownerId: string,
    request: McpUserListRequest,
  ): Promise<NamedPage<"pages", McpPrivateWikiPlaceholder>> {
    requireMcpUserRight(canListPrivateWikiPages(session));
    session.visibleAccount(ownerId);
    const placeholders = await context.wiki.listPlaceholders(
      context.actor,
      ownerId,
    );
    const pages = placeholders.map((placeholder) => ({
      id: placeholder.id,
      ownerId: placeholder.ownerId,
      allowedActions: { canDelete: true },
    }));
    const page = pageMcpUserList(pages, {
      session,
      list: "private-wiki",
      request,
      filters: ownerId,
      preserveOrder: true,
    });
    return { pages: page.entries, ...pageInfo(page) };
  }

  private async allUsers(session: McpUserSession): Promise<readonly McpUser[]> {
    session.requireManagement();
    // One transaction runs one statement at a time.
    const users = await session.administration.listUsers(session.actor.userId);
    const groups = await session.visibleGroups();
    return users.map((user) => projectMcpUser(session, user, groups));
  }
}
