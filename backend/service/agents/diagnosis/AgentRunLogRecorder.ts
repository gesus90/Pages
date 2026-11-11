import { redactLogText } from "@/backend/logging/LogRedaction";
import { logCaughtError, withLogContext } from "@/backend/logging/Logger";
import { registerRunLogSink } from "@/backend/logging/RunLogSink";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { AGENT_RUN_DIAGNOSIS_LIMITS } from "@/definition/AgentRunDiagnosis";

import type { AgentRunDiagnosisSettingsRepository } from "@/backend/database/repositories/diagnosis/AgentRunDiagnosisSettingsRepository";
import type {
  AgentRunLogRepository,
  StoredRunLogLine,
} from "@/backend/database/repositories/diagnosis/AgentRunLogRepository";
import type { AgentRunFailureRepository } from "@/backend/database/repositories/diagnosis/AgentRunFailureRepository";
import type { RunLogRecord } from "@/backend/logging/RunLogSink";

/** Lines kept in memory between two writes; further lines are dropped and counted. */
const MAXIMUM_BUFFER = 5_000;
const FLUSH_INTERVAL_MS = 1_000;
const PRUNE_INTERVAL_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Filters one log message of a run: credentials go and the text is bounded.
 *
 * @param message - The raw message.
 * @returns The safe message and whether filtering changed it.
 */
export function filterRunLogMessage(message: string): {
  readonly message: string;
  readonly isFiltered: boolean;
} {
  const safe = redactCredentials(redactLogText(message));
  const bounded =
    Buffer.byteLength(safe) > AGENT_RUN_DIAGNOSIS_LIMITS.logMessageBytes
      ? `${Buffer.from(safe)
          .subarray(0, AGENT_RUN_DIAGNOSIS_LIMITS.logMessageBytes - 16)
          .toString("utf8")}[TRUNCATED]`
      : safe;
  return { message: bounded, isFiltered: bounded !== message };
}

/**
 * Stores the log lines of plan runs, in batches, with their own retention.
 *
 * @remarks
 * The logger hands every line of a run, step or attempt to this recorder
 * (`RunLogSink`). Lines are filtered before they are kept, written once a
 * second and removed after the retention time of the diagnosis settings.
 */
export class AgentRunLogRecorder {
  private readonly logs: AgentRunLogRepository;
  private readonly failures: Pick<AgentRunFailureRepository, "prune">;
  private readonly settings: Pick<AgentRunDiagnosisSettingsRepository, "read">;
  private buffer: StoredRunLogLine[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private unregister: (() => void) | null = null;
  private pending: Promise<void> = Promise.resolve();

  public constructor(parts: {
    readonly logs: AgentRunLogRepository;
    readonly failures: Pick<AgentRunFailureRepository, "prune">;
    readonly settings: Pick<AgentRunDiagnosisSettingsRepository, "read">;
  }) {
    this.logs = parts.logs;
    this.failures = parts.failures;
    this.settings = parts.settings;
  }

  /** Starts receiving lines from the logger and writing them. */
  public start(): void {
    if (this.unregister !== null) return;
    this.unregister = registerRunLogSink((record) => this.accept(record));
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    this.flushTimer.unref();
    this.pruneTimer = setInterval(() => {
      void this.prune();
    }, PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
    void this.prune();
  }

  /** Stops receiving and writes what is left. */
  public async stop(): Promise<void> {
    this.unregister?.();
    this.unregister = null;
    if (this.flushTimer !== null) clearInterval(this.flushTimer);
    if (this.pruneTimer !== null) clearInterval(this.pruneTimer);
    this.flushTimer = null;
    this.pruneTimer = null;
    await this.flush();
  }

  /**
   * Keeps one line for the next write.
   *
   * @param record - The line as the logger or a runner hook reports it.
   */
  public accept(record: RunLogRecord): void {
    if (this.buffer.length >= MAXIMUM_BUFFER) return;
    const filtered = filterRunLogMessage(record.message);
    this.buffer.push({ ...record, ...filtered });
  }

  /** Writes the kept lines; writes never overlap. */
  public async flush(): Promise<void> {
    const lines = this.buffer;
    this.buffer = [];
    if (lines.length === 0) return this.pending;
    // Writing logs lines of its own, which must not become run lines again.
    this.pending = this.pending.then(() =>
      withLogContext(
        { runId: undefined, stepId: undefined, attemptId: undefined },
        () => this.logs.append(lines),
      ).catch((error: unknown) => {
        logCaughtError("AgentRunLogRecorder", error);
      }),
    );
    return this.pending;
  }

  /** Removes the lines and failure records past the retention time. */
  public async prune(): Promise<void> {
    try {
      const { logRetentionDays } = await this.settings.read();
      const cutoff = new Date(
        Date.now() - logRetentionDays * DAY_MS,
      ).toISOString();
      await this.logs.prune(cutoff);
      await this.failures.prune(cutoff);
    } catch (error: unknown) {
      logCaughtError("AgentRunLogRecorder", error);
    }
  }
}
