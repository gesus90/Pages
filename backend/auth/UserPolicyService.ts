import { ADMINISTRATION_ROLE_ID, CAPABILITY } from "@/definition/Authorization";

import { accountForChannel } from "./McpActorContext";

import type { ActorChannel } from "./McpActorContext";
import type {
  AccountAccess,
  Capability,
  UserRole,
} from "@/definition/Authorization";

/** Evaluates management policy from current persisted account facts. */
export class UserPolicyService {
  private readonly channel: ActorChannel;

  /** Keeps MCP's personal-admin exception separate from the default UI role mode. */
  public constructor(channel: ActorChannel = "ui") {
    this.channel = channel;
  }

  /** Uses active admin mode on the UI path and personal eligibility on the MCP path. */
  public isAdministrator(actor: AccountAccess): boolean {
    const account = accountForChannel(actor, this.channel);
    // An agent account is never an administrator, whatever is stored (PAGE-266).
    return (
      account.isActive &&
      account.isAdmin &&
      account.mode === "admin" &&
      account.isAgent !== true
    );
  }

  /** Recognizes the protected business role without granting core-system administration. */
  public isManagement(actor: AccountAccess): boolean {
    return actor.isActive && actor.role?.id === ADMINISTRATION_ROLE_ID;
  }

  /** Combines business-wide visibility with the existing administrator mode. */
  public hasGlobalAccess(actor: AccountAccess): boolean {
    return this.isAdministrator(actor) || this.isManagement(actor);
  }

  /** Checks a capability independently of target visibility and hierarchy. */
  public has(actor: AccountAccess, capability: Capability): boolean {
    return (
      this.isAdministrator(actor) ||
      (this.isManagement(actor) &&
        capability !== CAPABILITY.MANAGE_ROLES &&
        capability !== CAPABILITY.MANAGE_DEPARTMENTS) ||
      (actor.isActive &&
        actor.role !== null &&
        actor.role.permissions.includes(capability))
    );
  }

  /** Determines whether the account can enter the management area. */
  public canEnter(actor: AccountAccess): boolean {
    return [
      CAPABILITY.MANAGE_USERS,
      CAPABILITY.MANAGE_ROLES,
      CAPABILITY.MANAGE_DEPARTMENTS,
    ].some((permission) => this.has(actor, permission));
  }

  /** Tests the explicitly assigned department management range. */
  public canManageDepartment(
    actor: AccountAccess,
    departmentId: string,
  ): boolean {
    return (
      this.has(actor, CAPABILITY.MANAGE_DEPARTMENTS) &&
      (this.isAdministrator(actor) ||
        actor.allDepartments ||
        actor.managedDepartments.includes(departmentId))
    );
  }

  /** Combines visibility ranges without granting mutation rights. */
  public canSee(actor: AccountAccess, target: AccountAccess): boolean {
    if (!this.canEnter(actor)) {
      return false;
    }
    if (this.hasGlobalAccess(actor) || target.departments.length === 0) {
      return true;
    }
    const canSeeMembers =
      this.has(actor, CAPABILITY.MANAGE_ROLES) ||
      this.has(actor, CAPABILITY.MANAGE_USERS);
    return target.departments.some(
      (departmentId) =>
        (canSeeMembers && actor.departments.includes(departmentId)) ||
        this.canManageDepartment(actor, departmentId),
    );
  }

  /** Checks scope and hierarchy for an action on another account. */
  public canChange(
    actor: AccountAccess,
    target: AccountAccess,
    capability: Capability,
  ): boolean {
    if (this.isManagement(actor) && !this.isAdministrator(actor)) {
      return (
        !target.isAdmin &&
        actor.userId !== target.userId &&
        (capability === CAPABILITY.MANAGE_USERS ||
          capability === CAPABILITY.MANAGE_ROLES ||
          capability === CAPABILITY.MANAGE_DEPARTMENTS)
      );
    }
    const allowedRank =
      this.isAdministrator(actor) ||
      (actor.userId !== target.userId &&
        actor.role !== null &&
        target.role !== null &&
        actor.role.rank >= target.role.rank);
    return (
      allowedRank && this.has(actor, capability) && this.canSee(actor, target)
    );
  }

  /** Prevents assignment from granting a higher rank or additional capabilities. */
  public canAssignRole(actor: AccountAccess, role: UserRole): boolean {
    if (this.isAdministrator(actor)) return true;
    if (role.id === ADMINISTRATION_ROLE_ID) return false;
    if (this.isManagement(actor)) return true;
    return (
      actor.isActive &&
      actor.role !== null &&
      role.rank <= actor.role.rank &&
      !role.permissions.includes(CAPABILITY.MANAGE_ROLES) &&
      role.permissions.every((permission) => this.has(actor, permission))
    );
  }

  /** Shared-role edits require every current holder to be within the actor's scope. */
  public canEditRole(
    actor: AccountAccess,
    current: UserRole,
    next: UserRole,
    holders: readonly AccountAccess[],
  ): boolean {
    if (current.id === ADMINISTRATION_ROLE_ID) return false;
    if (this.isAdministrator(actor)) return true;
    if (this.isManagement(actor)) return false;
    return (
      actor.role !== null &&
      this.has(actor, CAPABILITY.MANAGE_ROLES) &&
      actor.role.id !== current.id &&
      current.rank <= actor.role.rank &&
      this.canAssignRole(actor, next) &&
      holders.every((holder) =>
        this.canChange(actor, holder, CAPABILITY.MANAGE_ROLES),
      )
    );
  }

  /** Validates the complete membership change against the pre-change state. */
  public canSetMemberships(
    actor: AccountAccess,
    target: AccountAccess,
    next: readonly string[],
  ): boolean {
    if (next.length === 0 && target.hasHadDepartment) {
      return false;
    }
    if (this.isAdministrator(actor)) return true;
    if (this.isManagement(actor))
      return !target.isAdmin && target.userId !== actor.userId;
    const capability = this.has(actor, CAPABILITY.MANAGE_DEPARTMENTS)
      ? CAPABILITY.MANAGE_DEPARTMENTS
      : CAPABILITY.MANAGE_ROLES;
    if (!this.canChange(actor, target, capability)) {
      return false;
    }
    if (target.departments.length === 0) {
      return next.every((id) =>
        capability === CAPABILITY.MANAGE_DEPARTMENTS
          ? this.canManageDepartment(actor, id)
          : actor.departments.includes(id),
      );
    }
    const removed = target.departments.filter((id) => !next.includes(id));
    const added = next.filter((id) => !target.departments.includes(id));
    return (
      target.departments.some((id) => this.canManageDepartment(actor, id)) &&
      [...removed, ...added].every((id) => this.canManageDepartment(actor, id))
    );
  }

  /** Groups are managed by everyone who may manage users. */
  public canManageGroups(actor: AccountAccess): boolean {
    return this.has(actor, CAPABILITY.MANAGE_USERS);
  }

  /** A group is listed when it is empty or has a member within the actor's directory scope. */
  public canSeeGroup(
    actor: AccountAccess,
    members: readonly AccountAccess[],
  ): boolean {
    return (
      this.canManageGroups(actor) &&
      (this.hasGlobalAccess(actor) ||
        members.length === 0 ||
        members.some((member) => this.canSee(actor, member)))
    );
  }

  /** Changing a group needs every involved member, old and new, within the actor's scope. */
  public canChangeGroup(
    actor: AccountAccess,
    members: readonly AccountAccess[],
  ): boolean {
    return (
      this.canManageGroups(actor) &&
      (this.hasGlobalAccess(actor) ||
        members.every((member) => this.canSee(actor, member)))
    );
  }
}
