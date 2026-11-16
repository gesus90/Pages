import type {
  AgentToolAction,
  AgentToolDiagnostic,
  AgentToolId,
  AgentToolOperationView,
  AgentToolPhase,
} from "@/definition/AgentTools";

/**
 * Keeps the last maintenance operation of each tool for the settings page.
 * @remarks
 * Only fixed phases and diagnostics are kept; upstream output, paths of
 * login data and secrets never enter it.
 */
export class AgentToolOperationLog {
  private readonly operations = new Map<AgentToolId, AgentToolOperationView>();

  /** Starts an operation that covers one tool or a CLI and its adapter. */
  public start(
    ids: readonly AgentToolId[],
    action: AgentToolAction,
    phase: AgentToolPhase,
  ): void {
    const operation: AgentToolOperationView = {
      action,
      state: "running",
      phase,
      diagnostic: null,
      retryAction: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    for (const id of ids) this.operations.set(id, operation);
  }

  /** Records the step that runs now. */
  public phase(ids: readonly AgentToolId[], phase: AgentToolPhase): void {
    this.update(ids, (operation) => ({ ...operation, phase }));
  }

  /** Ends the operation successfully. */
  public succeed(ids: readonly AgentToolId[]): void {
    this.update(ids, (operation) => ({
      ...operation,
      state: "succeeded",
      finishedAt: new Date().toISOString(),
    }));
  }

  /** Ends the operation at its current phase with a fixed reason and the action that repeats it. */
  public fail(
    ids: readonly AgentToolId[],
    diagnostic: AgentToolDiagnostic,
    retryAction: AgentToolAction | null,
  ): void {
    this.update(ids, (operation) => ({
      ...operation,
      state: "failed",
      diagnostic,
      retryAction,
      finishedAt: new Date().toISOString(),
    }));
  }

  /** The last operation of a tool, or `null` before the first one. */
  public get(id: AgentToolId): AgentToolOperationView | null {
    return this.operations.get(id) ?? null;
  }

  private update(
    ids: readonly AgentToolId[],
    change: (operation: AgentToolOperationView) => AgentToolOperationView,
  ): void {
    for (const id of ids) {
      const operation = this.operations.get(id);
      if (operation) this.operations.set(id, change(operation));
    }
  }
}
