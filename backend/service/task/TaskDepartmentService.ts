import { TicketDepartmentPolicy } from "@/backend/auth/TicketDepartmentPolicy";
import {
  WorkItemAccessDeniedError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { AuthorizationFacts } from "@/backend/service/project/ProjectAccessService";
import type { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import type {
  TicketAssigneeSight,
  TicketAssigneeTarget,
  TicketDepartmentChoices,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/** Drops blank and repeated ids; an empty result means "no department". */
function normalize(selection: readonly string[] | null | undefined): string[] {
  const ids = (selection ?? [])
    .map((id) => id.trim())
    .filter((id) => id !== "");

  return [...new Set(ids)];
}

/** Whether two id lists hold the same ids, regardless of order. */
function hasSameIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((departmentId) => right.includes(departmentId))
  );
}

/** Names the departments for the audit trail; `null` for none. */
function namesOf(
  facts: AuthorizationFacts,
  departmentIds: readonly string[],
): string | null {
  const names = departmentIds.map(
    (departmentId) =>
      facts.departments.find((department) => department.id === departmentId)
        ?.name ?? departmentId,
  );

  return names.length === 0 ? null : names.join(", ");
}

/** Assigns tickets to departments within the actor's selectable scope. */
export class TaskDepartmentService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;
  private readonly history: TaskHistoryRecorder;
  private readonly cache: ServerCache;
  private readonly policy = new TicketDepartmentPolicy();

  /**
   * Creates a department service.
   *
   * @param taskRepository - Task persistence boundary.
   * @param access - Guard resolving write access and current account facts.
   * @param history - Recorder of the ticket audit trail.
   * @param cache - Shared server cache invalidated by assignment changes.
   */
  public constructor(
    taskRepository: TaskRepository,
    access: TaskAccessGuard,
    history: TaskHistoryRecorder,
    cache: ServerCache,
  ) {
    this.taskRepository = taskRepository;
    this.access = access;
    this.history = history;
    this.cache = cache;
  }

  /** Returns the departments the actor may currently select for a ticket. */
  public async choices(actor: User): Promise<TicketDepartmentChoices> {
    const { account, departments } =
      await this.access.authorizationFacts(actor);

    return {
      available: departments.filter((department) =>
        this.policy.canSelect(account, department.id),
      ),
      known: departments,
    };
  }

  /**
   * Validates a department selection of a new ticket against the live catalog and scope.
   *
   * @param actor - User making the selection.
   * @param selection - Raw department ids; blank or empty means no department.
   * @returns The distinct department ids to store, empty for a ticket without one.
   * @throws {WorkItemValidationError} When a department does not exist.
   * @throws {WorkItemAccessDeniedError} When the actor may not select one.
   */
  public async resolve(
    actor: User,
    selection: readonly string[] | null | undefined,
  ): Promise<string[]> {
    const departmentIds = normalize(selection);

    if (departmentIds.length === 0) {
      return [];
    }

    const facts = await this.access.authorizationFacts(actor);

    return departmentIds.map((departmentId) =>
      this.validate(facts, departmentId),
    );
  }

  /**
   * Replaces the departments of a ticket, apart from content edits.
   *
   * @param actor - User with write access to the ticket.
   * @param id - Ticket to reassign.
   * @param selection - New department ids; empty makes the ticket visible to the whole project.
   * @param expected - Previously displayed department ids, when checking for conflicts.
   *
   * @remarks
   * Added departments and removed departments each need the right to select
   * them. Removing every department is the exception: anyone who may write
   * the ticket may open it to the whole project.
   */
  public async setDepartments(
    actor: User,
    id: string,
    selection: readonly string[],
    expected?: readonly string[],
  ): Promise<void> {
    const existing = await this.access.requireWritableWorkItem(actor, id);
    const facts = await this.access.authorizationFacts(actor);
    const requested = normalize(selection);
    const current = existing.departmentIds;

    if (expected !== undefined && !hasSameIds(current, normalize(expected))) {
      throw new WorkItemValidationError("ticketConflict");
    }
    if (hasSameIds(current, requested)) {
      return;
    }
    // Departments the ticket keeps need no right of the actor.
    for (const departmentId of requested.filter(
      (candidate) => !current.includes(candidate),
    )) {
      this.validate(facts, departmentId);
    }
    if (requested.length > 0) {
      for (const departmentId of current.filter(
        (candidate) => !requested.includes(candidate),
      )) {
        this.requireSelectable(facts, departmentId);
      }
    }

    const changed = await this.taskRepository.setDepartments(
      id,
      requested,
      expected === undefined ? undefined : normalize(expected),
    );
    if (!changed) throw new WorkItemValidationError("ticketConflict");
    this.cache.invalidateWorkItems();
    await this.history.recordDepartmentChanged(actor, id, {
      newName: namesOf(facts, requested),
      oldName: namesOf(facts, current),
    });
  }

  /**
   * Tells whether the person, or the members of the group, can see a ticket with the given departments.
   *
   * @param actor - User asking; may only offer departments they can select.
   * @param target - Departments of the ticket and the person or group assigned.
   * @returns Whether everyone concerned sees the ticket, and the departments
   * of those who do not, which the actor could add.
   *
   * @remarks
   * Assigning gives no sight. This only answers the question for the notice
   * shown before the assignment; it never changes anything.
   */
  public async assigneeSight(
    actor: User,
    target: TicketAssigneeTarget,
  ): Promise<TicketAssigneeSight> {
    const facts = await this.access.authorizationFacts(actor);
    const candidates = await this.taskRepository.findEligibleAssignees();
    const group =
      target.groupId === null
        ? null
        : ((await this.taskRepository.findAssigneeGroupsWithMembers()).find(
            (entry) => entry.id === target.groupId,
          ) ?? null);
    const personIds = target.personId === null ? [] : [target.personId];
    const memberIds = group?.memberIds ?? personIds;
    const members = candidates.filter((user) => memberIds.includes(user.id));
    const targetName =
      group?.name ?? members[0]?.displayName ?? target.personId ?? "";
    const blindDepartmentIds = new Set<string>();
    let hasBlindMember = false;

    if (target.departmentIds.length > 0) {
      for (const member of members) {
        const visibility = await this.access.visibility(member);
        const sees =
          visibility.departmentIds === null ||
          target.departmentIds.some((id) =>
            visibility.departmentIds?.includes(id),
          );
        if (!sees) {
          hasBlindMember = true;
          const own = (await this.access.authorizationFacts(member)).account;
          own.departments.forEach((id) => blindDepartmentIds.add(id));
        }
      }
    }

    return {
      canSee: !hasBlindMember,
      isGroup: group !== null,
      targetName,
      offer: facts.departments.filter(
        (department) =>
          blindDepartmentIds.has(department.id) &&
          !target.departmentIds.includes(department.id) &&
          this.policy.canSelect(facts.account, department.id),
      ),
    };
  }

  private validate(facts: AuthorizationFacts, departmentId: string): string {
    if (
      !facts.departments.some((department) => department.id === departmentId)
    ) {
      throw new WorkItemValidationError("departmentNotFound");
    }

    this.requireSelectable(facts, departmentId);

    return departmentId;
  }

  private requireSelectable(
    facts: AuthorizationFacts,
    departmentId: string,
  ): void {
    if (!this.policy.canSelect(facts.account, departmentId)) {
      throw new WorkItemAccessDeniedError();
    }
  }
}
