import { TicketDepartmentPolicy } from "@/backend/auth/TicketDepartmentPolicy";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";

import type { AccountAccess } from "@/definition/Authorization";
import type { TemplateSharing } from "@/definition/WorkItemTemplate";

/** Decides who sees, shares and manages ticket templates. */
export class WorkItemTemplatePolicy {
  private readonly users = new UserPolicyService();
  private readonly departments = new TicketDepartmentPolicy();

  /**
   * Tests whether the account may see and use a template.
   *
   * @param actor - Current account facts.
   * @param template - Owner and sharing of the template.
   * @param accessibleProjectIds - Projects the account may currently open.
   * @remarks
   * The owner and the administrator mode always see it; everyone else sees
   * templates shared with all, with one of their departments, or with a
   * project they can open.
   */
  public canView(
    actor: AccountAccess,
    template: TemplateSharing & { readonly ownerId: string },
    accessibleProjectIds: ReadonlySet<string>,
  ): boolean {
    if (!actor.isActive) {
      return false;
    }

    return (
      this.users.isAdministrator(actor) ||
      template.ownerId === actor.userId ||
      template.scope === TEMPLATE_SCOPE.ALL ||
      (template.scope === TEMPLATE_SCOPE.DEPARTMENTS &&
        template.departmentIds.some((id) => actor.departments.includes(id))) ||
      (template.scope === TEMPLATE_SCOPE.PROJECTS &&
        template.projectIds.some((id) => accessibleProjectIds.has(id)))
    );
  }

  /** Tests whether the account may rename, reshare or delete a template: its owner and the administrator mode. */
  public canManage(
    actor: AccountAccess,
    template: { readonly ownerId: string },
  ): boolean {
    return (
      actor.isActive &&
      (this.users.isAdministrator(actor) || template.ownerId === actor.userId)
    );
  }

  /**
   * Tests whether the account may share a template the way requested.
   *
   * @remarks
   * Everyone shares privately or with all. Sharing with departments needs at
   * least one department and only ones the account may select for a ticket,
   * which are its own and the ones it manages. Sharing with projects needs at
   * least one project and only ones the account may open.
   */
  public canShare(
    actor: AccountAccess,
    sharing: TemplateSharing,
    accessibleProjectIds: ReadonlySet<string>,
  ): boolean {
    if (!actor.isActive) {
      return false;
    }

    if (sharing.scope === TEMPLATE_SCOPE.DEPARTMENTS) {
      return (
        sharing.departmentIds.length > 0 &&
        sharing.departmentIds.every((id) =>
          this.departments.canSelect(actor, id),
        )
      );
    }

    if (sharing.scope === TEMPLATE_SCOPE.PROJECTS) {
      return (
        sharing.projectIds.length > 0 &&
        sharing.projectIds.every((id) => accessibleProjectIds.has(id))
      );
    }

    return true;
  }
}
