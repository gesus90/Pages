import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { AgentPlanWorkspaceConflictError } from "@/backend/error/AgentPlanWorkspaceConflictError";

/** Defers configuration failures to the affected step; access and approval refusals still propagate. */
export class AgentPlanPreparationFailures {
  private readonly failures: Record<string, string> = {};

  /** Safe error codes persisted with the snapshot for dispatch and recovery. */
  public snapshot(): Readonly<Record<string, string>> {
    return { ...this.failures };
  }

  /** Prepares one node without letting its incomplete configuration refuse the run. */
  public async capture<T>(
    nodeId: string | readonly string[],
    prepare: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await prepare();
    } catch (error: unknown) {
      if (error instanceof AgentPlanValidationError) {
        for (const issue of error.issues)
          this.record(issue.nodeId ?? nodeId, error.code);
        return undefined;
      }
      if (error instanceof AgentPlanWorkspaceConflictError) {
        for (const node of error.conflict.nodes)
          this.record(node.id, error.code);
        return undefined;
      }
      if (!(error instanceof AgentError) || !isDeferredCode(error.code))
        throw error;
      this.record(nodeId, error.code);
      return undefined;
    }
  }

  private record(nodeId: string | readonly string[], code: string): void {
    for (const id of typeof nodeId === "string" ? [nodeId] : nodeId)
      this.failures[id] = code;
  }
}

function isDeferredCode(code: string): boolean {
  return [
    "parameter_invalid",
    "parameter_required",
    "parameter_number_invalid",
    "plan_binding_invalid",
    "configuration_invalid",
    "plan_directory_required",
    "plan_script_invalid",
    "plan_script_interpreter_unavailable",
    "run_notes_unsupported",
    "plan_remote_unavailable",
  ].includes(code);
}
