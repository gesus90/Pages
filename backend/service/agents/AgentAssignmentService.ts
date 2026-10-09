import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isAgentFunction } from "@/definition/AgentAssignment";

import { resolveAgentAssignment } from "./AgentAssignmentResolution";
import { requireAgentAdministrator } from "./AgentServiceAccess";

import type { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentAssignment,
  AgentAssignmentView,
} from "@/definition/AgentAssignment";
import type { AgentOperationRegistry } from "./AgentOperationRegistry";

/** Admin-only configuration of predefined functions; it never runs those functions. */
export class AgentAssignmentService {
  private readonly assignments: AgentAssignmentRepository;
  private readonly connections: AgentConnectionRepository;
  private readonly operations: AgentOperationRegistry;
  private readonly writes = new SerialQueue();

  public constructor(dependencies: {
    readonly assignments: AgentAssignmentRepository;
    readonly connections: AgentConnectionRepository;
    readonly operations: AgentOperationRegistry;
  }) {
    this.assignments = dependencies.assignments;
    this.connections = dependencies.connections;
    this.operations = dependencies.operations;
  }

  /** Lists persisted choices without fixing them or requesting provider data. */
  public async list(
    actor: AccountAccess,
  ): Promise<readonly AgentAssignmentView[]> {
    requireAgentAdministrator(actor);
    return Promise.all(
      (await this.assignments.list()).map(async (assignment) => {
        try {
          await resolveAgentAssignment(this.connections, assignment);
          return { ...assignment, error: null };
        } catch (error: unknown) {
          if (!(error instanceof TextAssistantError)) throw error;
          return { ...assignment, error: error.code };
        }
      }),
    );
  }

  /** Serializes uniqueness and blocks connection removal while validating and saving. */
  public async save(
    actor: AccountAccess,
    assignment: AgentAssignment,
    mode: "create" | "update",
  ): Promise<void> {
    requireAgentAdministrator(actor);
    if (!isAgentFunction(assignment.function))
      throw new AgentError("function_invalid");
    await this.writes.run(() =>
      this.operations.run(assignment.connectionId, "write", async () => {
        const exists = (await this.assignments.list()).some(
          (entry) => entry.function === assignment.function,
        );
        if (mode === "create" && exists)
          throw new AgentError("assignment_exists");
        if (mode === "update" && !exists)
          throw new AgentError("assignment_not_found");
        await resolveAgentAssignment(this.connections, assignment);
        await this.assignments.save(assignment);
      }),
    );
  }

  /** Removes only the selected assignment; ongoing requests keep their resolved snapshot. */
  public async remove(
    actor: AccountAccess,
    assignedFunction: string,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    if (!isAgentFunction(assignedFunction))
      throw new AgentError("function_invalid");
    await this.writes.run(() => this.assignments.remove(assignedFunction));
  }
}
