import { CAPABILITY } from "@/definition/Authorization";

import type {
  AccountAccess,
  Capability,
  UserRole,
} from "@/definition/Authorization";

/** Evaluates management policy from current persisted account facts. */
export class UserPolicyService {
  /** Personal administrator eligibility grants power only in active admin mode. */
  public isAdministrator(actor: AccountAccess): boolean {
    return actor.isActive && actor.isAdmin && actor.mode === "admin";
  }

  /** Checks a capability independently of target visibility and hierarchy. */
  public has(actor: AccountAccess, capability: Capability): boolean {
    return (
      this.isAdministrator(actor) ||
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
    if (this.isAdministrator(actor) || target.departments.length === 0) {
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
    if (this.isAdministrator(actor)) {
      return true;
    }
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
    if (this.isAdministrator(actor)) {
      return true;
    }
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
    if (this.isAdministrator(actor)) {
      return true;
    }
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
}
