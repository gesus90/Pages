import type {
  AgentRunLogLevel,
  AgentRunLogSource,
} from "@/definition/AgentRunDiagnosis";

/** One log line that belongs to a plan run, before it is stored. */
export interface RunLogRecord {
  /** Absent for a line that only knows its attempt; the store finds the run. */
  readonly runId: string | null;
  readonly stepId: string | null;
  readonly attemptId: string | null;
  readonly at: string;
  readonly level: AgentRunLogLevel;
  readonly source: AgentRunLogSource;
  readonly message: string;
}

type RunLogListener = (record: RunLogRecord) => void;

const listeners = new Set<RunLogListener>();

/**
 * Registers the store of run log lines.
 *
 * @param listener - Receives every line that carries a run, step or attempt.
 * @returns Removes the listener again.
 *
 * @remarks
 * The logger knows no database. The process that owns the run services
 * registers the store, so a stand-in can take its place without real runs.
 */
export function registerRunLogSink(listener: RunLogListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Hands a log line of a run to the registered stores.
 *
 * @param record - The line; its message is filtered again by the store.
 *
 * @remarks
 * Never throws: a failing store must not disturb the run that logs.
 */
export function emitRunLog(record: RunLogRecord): void {
  for (const listener of listeners) {
    try {
      listener(record);
    } catch {
      // A failing store must not disturb the run; the line is only diagnostics.
      continue;
    }
  }
}
