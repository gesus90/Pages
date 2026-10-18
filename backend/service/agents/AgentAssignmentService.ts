import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { isAgentFunction } from "@/definition/AgentAssignment";
import { logCaughtError } from "@/backend/logging/Logger";

import { resolveAgentAssignment } from "./AgentAssignmentResolution";
import { requireAgentAdministrator } from "./AgentServiceAccess";

import type { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentAssignmentView } from "@/definition/AgentAssignment";

/** Admin-only configuration of predefined functions; it never runs those functions. */
export class AgentAssignmentService {
  private readonly assignments: AgentAssignmentRepository;
  private readonly connections: AgentConnectionRepository;
  private readonly writes = new SerialQueue();

  public constructor(dependencies: {
    readonly assignments: AgentAssignmentRepository;
    readonly connections: AgentConnectionRepository;
  }) {
    this.assignments = dependencies.assignments;
    this.connections = dependencies.connections;
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
          logCaughtError("AgentAssignmentService", error);

          if (!(error instanceof AgentExecutionError)) throw error;
          return { ...assignment, error: error.code };
        }
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
