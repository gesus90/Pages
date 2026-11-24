import { agentToolDefinition, pairedCli } from "./AgentToolRegistry";

import type {
  AgentToolAction,
  AgentToolDiagnostic,
  AgentToolId,
  AgentToolOperationView,
  AgentToolPhase,
} from "@/definition/AgentTools";
import type { AgentToolStorage } from "./AgentToolContracts";

/** Keeps each changed operation outside the process, so a reload or restart still shows it. */
export type AgentToolOperationPersistence = (
  id: AgentToolId,
  operation: AgentToolOperationView,
) => void;

/**
 * Keeps the last maintenance operation of each tool for the settings page.
 * @remarks
 * Only fixed phases and diagnostics are kept; upstream output, paths of
 * login data and secrets never enter it.
 */
export class AgentToolOperationLog {
  private readonly operations = new Map<AgentToolId, AgentToolOperationView>();
  private readonly persist: AgentToolOperationPersistence | null;

  public constructor(persist: AgentToolOperationPersistence | null = null) {
    this.persist = persist;
  }

  /**
   * Takes over the operations kept before a restart.
   * @remarks
   * An operation that was still running when its process ended is shown as
   * interrupted, with the same action as its repetition; one that another
   * live process still runs, as its combination's lock shows, stays running.
   * @param files - The tools directory with the kept operations and locks.
   */
  public async restore(
    files: Pick<AgentToolStorage, "readOperations" | "isLocked">,
  ): Promise<void> {
    // Missing history never blocks the tools; the next operation writes it again.
    try {
      const kept = (await files.readOperations?.()) ?? new Map();
      for (const [id, operation] of kept) await this.take(files, id, operation);
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error ? error.code : null;
      console.warn(
        `[pages] Kept agent tool operations cannot be read (${String(code ?? "invalid")}).`,
      );
    }
  }

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
    for (const id of ids) {
      this.operations.set(id, operation);
      this.persist?.(id, operation);
    }
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

  private async take(
    files: Pick<AgentToolStorage, "isLocked">,
    id: AgentToolId,
    operation: AgentToolOperationView,
  ): Promise<void> {
    if (this.operations.has(id)) return;
    const key = pairedCli(agentToolDefinition(id)).id;
    if (
      operation.state !== "running" ||
      ((await files.isLocked?.(key)) ?? false)
    ) {
      this.operations.set(id, operation);
      return;
    }
    const interrupted: AgentToolOperationView = {
      ...operation,
      state: "failed",
      diagnostic: "update_interrupted",
      retryAction: operation.action,
      finishedAt: new Date().toISOString(),
    };
    this.operations.set(id, interrupted);
    this.persist?.(id, interrupted);
  }

  private update(
    ids: readonly AgentToolId[],
    change: (operation: AgentToolOperationView) => AgentToolOperationView,
  ): void {
    for (const id of ids) {
      const operation = this.operations.get(id);
      if (!operation) continue;
      const changed = change(operation);
      this.operations.set(id, changed);
      this.persist?.(id, changed);
    }
  }
}
