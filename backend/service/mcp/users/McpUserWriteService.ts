import { CAPABILITY } from "@/definition/Authorization";

import { McpUserError } from "./McpUserError";
import {
  requireMcpUserConfirmation,
  requireMcpUserCurrent,
  requireMcpUserRight,
  sortedIds,
} from "./McpUserSession";

import type { McpUserCommand, McpUserMutation } from "./McpUserCommand";
import type { McpUserChangeResult } from "./McpUserContract";
import type {
  McpUserActiveRequest,
  McpUserAdministratorRequest,
  McpUserCreateRequest,
  McpUserDepartmentsRequest,
  McpUserResetRequest,
  McpUserScopeRequest,
  McpUserUpdateRequest,
} from "./McpUserRequest";
import type { McpUserSession } from "./McpUserSession";

/** The fields of a profile change. */
const PROFILE_FIELDS = ["username", "firstName", "lastName", "email"] as const;

/** A profile as the user management edits it. */
interface McpUserProfile {
  readonly username: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string | null;
}

/**
 * Drops the confirmation from what identifies a request, so a repetition
 * need not repeat it: JSON leaves an undefined field out.
 */
export function withoutConfirmation<Body extends { confirmation?: string }>(
  body: Body,
): Body {
  return { ...body, confirmation: undefined };
}

/** The result of a change of one account. */
function personResult(userId: string, changed: boolean): McpUserChangeResult {
  return {
    id: userId,
    targetType: "person",
    changed,
    affectedUserIds: changed ? [userId] : [],
  };
}

/** Reads the current profile of a visible account. */
async function currentProfile(
  session: McpUserSession,
  userId: string,
): Promise<McpUserProfile> {
  const account = session.visibleAccount(userId);
  const users = session.repository.users();
  const user = await users.findById(userId);
  if (user === null) throw new McpUserError("not_found");
  const emails = await users.findEmailsByUserIds([userId]);
  return {
    username: user.username,
    firstName: account.firstName,
    lastName: account.lastName,
    email: emails.get(userId) ?? null,
  };
}

/**
 * Changes accounts through the administration of the interface (PAGE-280):
 * creation, profile, activity, password reset, memberships, scope and
 * administrator eligibility.
 *
 * @remarks
 * Each method returns the command for `McpUserApi.change`. The command
 * reads the target inside the transaction, compares the state the client
 * read, asks for a confirmation where the interface does, and then calls
 * the service method of the interface, which checks the policy once more.
 */
export class McpUserWriteService {
  /**
   * Creates an account with a temporary password and forced password change.
   *
   * @param request - The validated body.
   */
  public create(request: McpUserCreateRequest): McpUserCommand {
    return {
      operation: {
        name: "admin.users.create",
        operationId: request.operationId,
        request,
        guard: (session) => session.requireCapability(CAPABILITY.MANAGE_USERS),
      },
      apply: async (session) => {
        const username = request.username.trim();
        const { temporaryPassword } = await session.administration.createUser(
          session.actor.userId,
          {
            username,
            firstName: request.firstName,
            lastName: request.lastName,
            email: request.email,
            roleId: request.roleId,
            isAdmin: request.isAdmin,
            departments: request.departmentIds,
          },
        );
        const user = (await session.repository.users().findAll()).find(
          (candidate) => candidate.username === username,
        );
        if (user === undefined)
          throw new Error("The created account is missing.");
        return {
          result: personResult(user.id, true),
          credential: { user: { id: user.id, username }, temporaryPassword },
        };
      },
    };
  }

  /**
   * Changes username, first and last name or email; omitted fields stay.
   *
   * @param userId - The account.
   * @param request - The changed fields and their read values in `expected`.
   */
  public update(userId: string, request: McpUserUpdateRequest): McpUserCommand {
    return {
      operation: {
        name: "admin.users.update",
        operationId: request.operationId,
        request: { userId, ...request },
        guard: (session) => session.requireCapability(CAPABILITY.MANAGE_ROLES),
      },
      apply: async (session) => {
        const current = await currentProfile(session, userId);
        requireMcpUserRight(
          session.policy.canChange(
            session.actor,
            session.visibleAccount(userId),
            CAPABILITY.MANAGE_ROLES,
          ),
        );
        for (const field of PROFILE_FIELDS)
          if (request.expected[field] !== undefined)
            requireMcpUserCurrent(current[field], request.expected[field]);
        const next: McpUserProfile = {
          username: request.username ?? current.username,
          firstName: request.firstName ?? current.firstName,
          lastName: request.lastName ?? current.lastName,
          email: request.email === undefined ? current.email : request.email,
        };
        const changed = PROFILE_FIELDS.some(
          (field) => next[field] !== current[field],
        );
        if (changed)
          await session.administration.updateProfile(
            session.actor.userId,
            userId,
            next,
          );
        return { result: personResult(userId, changed) };
      },
    };
  }

  /**
   * Activates or deactivates an account; a deactivation needs a confirmation.
   *
   * @param userId - The account.
   * @param request - The new state and the read one.
   */
  public setActive(
    userId: string,
    request: McpUserActiveRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.users.setActive",
        operationId: request.operationId,
        request: { userId, ...withoutConfirmation(request) },
        guard: (session) => session.requireCapability(CAPABILITY.MANAGE_USERS),
      },
      apply: async (session) => {
        const target = session.visibleAccount(userId);
        requireMcpUserRight(
          session.policy.canChange(
            session.actor,
            target,
            CAPABILITY.MANAGE_USERS,
          ),
        );
        requireMcpUserCurrent(target.isActive, request.expected.isActive);
        const changed = target.isActive !== request.isActive;
        if (changed && !request.isActive)
          requireMcpUserConfirmation(request.confirmation, {
            target: { type: "person", id: userId },
            effects: ["account_deactivated", "group_memberships_removed"],
            affectedUserIds: [userId],
          });
        if (changed)
          await session.administration.setActive(
            session.actor.userId,
            userId,
            request.isActive,
          );
        return { result: personResult(userId, changed) };
      },
    };
  }

  /**
   * Replaces the password of an account by a temporary one.
   *
   * @param userId - The account.
   * @param request - The operation ID and the confirmation.
   *
   * @remarks
   * The reset forces a password change and ends the sessions of the
   * account, like in the interface; no other account data changes.
   */
  public resetPassword(
    userId: string,
    request: McpUserResetRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.users.resetPassword",
        operationId: request.operationId,
        request: { userId, ...withoutConfirmation(request) },
        guard: (session) => session.requireCapability(CAPABILITY.MANAGE_USERS),
      },
      apply: async (session): Promise<McpUserMutation> => {
        const profile = await currentProfile(session, userId);
        requireMcpUserRight(
          session.policy.canChange(
            session.actor,
            session.visibleAccount(userId),
            CAPABILITY.MANAGE_USERS,
          ),
        );
        requireMcpUserConfirmation(request.confirmation, {
          target: { type: "person", id: userId },
          effects: [
            "password_replaced",
            "sessions_revoked",
            "password_change_required",
          ],
          affectedUserIds: [userId],
        });
        const { temporaryPassword } =
          await session.administration.resetPassword(
            session.actor.userId,
            userId,
          );
        return {
          result: personResult(userId, true),
          credential: {
            user: { id: userId, username: profile.username },
            temporaryPassword,
          },
        };
      },
    };
  }

  /**
   * Replaces the department memberships of an account.
   *
   * @param userId - The account.
   * @param request - The complete new list and the read one.
   *
   * @remarks
   * An empty list is an explicit change; an account that had a department
   * keeps at least one (`last_membership`). Removing a membership needs a
   * confirmation.
   */
  public setDepartments(
    userId: string,
    request: McpUserDepartmentsRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.users.setDepartments",
        operationId: request.operationId,
        request: { userId, ...withoutConfirmation(request) },
        guard: (session) => session.requireManagement(),
      },
      apply: async (session) => {
        const target = session.visibleAccount(userId);
        const next = sortedIds(request.departmentIds);
        if (next.length === 0 && target.hasHadDepartment)
          throw new McpUserError("last_membership");
        requireMcpUserRight(
          session.policy.canSetMemberships(session.actor, target, next),
        );
        requireMcpUserCurrent(
          sortedIds(target.departments),
          sortedIds(request.expected.departmentIds),
        );
        const removed = target.departments.filter((id) => !next.includes(id));
        if (removed.length > 0)
          requireMcpUserConfirmation(request.confirmation, {
            target: { type: "person", id: userId },
            effects: removed.map((id) => `department_membership_removed:${id}`),
            affectedUserIds: [userId],
          });
        const changed =
          JSON.stringify(sortedIds(target.departments)) !==
          JSON.stringify(next);
        if (changed)
          await session.administration.setMemberships(
            session.actor.userId,
            userId,
            next,
          );
        return { result: personResult(userId, changed) };
      },
    };
  }

  /**
   * Sets the personal management scope; administrators only.
   *
   * @param userId - The account.
   * @param request - The complete new scope and the read one.
   */
  public setScope(
    userId: string,
    request: McpUserScopeRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.users.setScope",
        operationId: request.operationId,
        request: { userId, ...withoutConfirmation(request) },
        guard: (session) => session.requireAdministrator(),
      },
      apply: async (session) => {
        const target = session.visibleAccount(userId);
        const current = {
          managedDepartments: sortedIds(target.managedDepartments),
          allDepartments: target.allDepartments,
          allProjects: target.allProjects,
        };
        const next = {
          ...request.scope,
          managedDepartments: sortedIds(request.scope.managedDepartments),
        };
        requireMcpUserCurrent(current, {
          ...request.expected.scope,
          managedDepartments: sortedIds(
            request.expected.scope.managedDepartments,
          ),
        });
        const isReduced =
          (current.allProjects && !next.allProjects) ||
          (current.allDepartments && !next.allDepartments) ||
          current.managedDepartments.some(
            (id) => !next.managedDepartments.includes(id),
          );
        if (isReduced)
          requireMcpUserConfirmation(request.confirmation, {
            target: { type: "person", id: userId },
            effects: ["management_scope_reduced"],
            affectedUserIds: [userId],
          });
        const changed = JSON.stringify(current) !== JSON.stringify(next);
        if (changed)
          await session.administration.setScope(
            session.actor.userId,
            userId,
            next,
          );
        return { result: personResult(userId, changed) };
      },
    };
  }

  /**
   * Grants or revokes personal administrator eligibility; administrators only.
   *
   * @param userId - The account.
   * @param request - The new state, the read one and the confirmation.
   *
   * @remarks
   * The last active administrator keeps the eligibility
   * (`last_administrator`); the normal role stays as it is.
   */
  public setAdministrator(
    userId: string,
    request: McpUserAdministratorRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.users.setAdministrator",
        operationId: request.operationId,
        request: { userId, ...withoutConfirmation(request) },
        guard: (session) => session.requireAdministrator(),
      },
      apply: async (session) => {
        const target = session.visibleAccount(userId);
        requireMcpUserCurrent(target.isAdmin, request.expected.isAdmin);
        const changed = target.isAdmin !== request.isAdmin;
        if (changed)
          requireMcpUserConfirmation(request.confirmation, {
            target: { type: "person", id: userId },
            effects: [
              request.isAdmin
                ? "administrator_granted"
                : "administrator_revoked",
            ],
            affectedUserIds: [userId],
          });
        if (changed)
          await session.administration.setAdministrator(
            session.actor.userId,
            userId,
            request.isAdmin,
          );
        return { result: personResult(userId, changed) };
      },
    };
  }
}
