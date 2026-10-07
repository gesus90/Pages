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
import type { TicketDepartmentChoices } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Treats missing and blank selections alike as "no department". */
function normalize(selection: string | null | undefined): string | null {
  const trimmed = selection?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
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
    };
  }

  /**
   * Validates an optional department selection against the live catalog and scope.
   *
   * @param actor - User making the selection.
   * @param selection - Raw department id; blank means no department.
   * @returns The department id to store, or `null` for a ticket without one.
   * @throws {WorkItemValidationError} When the department does not exist.
   * @throws {WorkItemAccessDeniedError} When the actor may not select it.
   */
  public async resolve(
    actor: User,
    selection: string | null | undefined,
  ): Promise<string | null> {
    const departmentId = normalize(selection);

    if (departmentId === null) {
      return null;
    }

    return this.validate(
      await this.access.authorizationFacts(actor),
      departmentId,
    );
  }

  /**
   * Reassigns a ticket, or clears its department, apart from content edits.
   *
   * @param actor - User with write access to the ticket.
   * @param id - Ticket to reassign.
   * @param selection - New department id; blank clears the assignment.
   */
  public async setDepartment(
    actor: User,
    id: string,
    selection: string | null,
  ): Promise<void> {
    const existing = await this.access.requireWritableWorkItem(actor, id);
    const facts = await this.access.authorizationFacts(actor);
    const requested = normalize(selection);
    const departmentId =
      requested === null ? null : this.validate(facts, requested);

    if (departmentId === existing.departmentId) {
      return;
    }

    const nameOf = (candidate: string | null): string | null =>
      facts.departments.find((department) => department.id === candidate)
        ?.name ?? null;

    await this.taskRepository.setDepartment(id, departmentId);
    this.cache.invalidateWorkItems();
    await this.history.recordDepartmentChanged(actor, id, {
      newName: nameOf(departmentId),
      oldName: nameOf(existing.departmentId),
    });
  }

  private validate(facts: AuthorizationFacts, departmentId: string): string {
    if (
      !facts.departments.some((department) => department.id === departmentId)
    ) {
      throw new WorkItemValidationError("departmentNotFound");
    }

    if (!this.policy.canSelect(facts.account, departmentId)) {
      throw new WorkItemAccessDeniedError();
    }

    return departmentId;
  }
}
