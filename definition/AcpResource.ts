/** Limits for native ACP processes; memory and idle duration use MiB and milliseconds. */
export interface AcpResourceOptions {
  readonly maxConcurrentAcpSessions: number;
  readonly memoryAwareScheduling: boolean;
  readonly minimumAvailableMemory: number;
  readonly acpIdleTimeout: number;
  readonly queueDiscipline: "fifo";
}

/** Sanitized ownership of one native process and all its descendants. */
export interface AcpResourceOwner {
  readonly instanceId: string;
  readonly userId: string;
  readonly provider: "codex_cli" | "claude_code" | "opencode";
  readonly runId: string | null;
  readonly stepId: string | null;
}

export type AcpResourceState =
  "starting" | "running" | "idle" | "closing" | "cleanup_failed";

/** Durable reservation: even a starting or uncertain process owns capacity. */
export interface AcpResourceRecord extends AcpResourceOwner {
  readonly state: AcpResourceState;
  readonly since: string;
}

export type AcpWaitReason =
  | "capacity"
  | "memory"
  | "memory_unknown"
  | "paused"
  | "recovery"
  | "scheduler_error";

/** Instance-wide diagnostics, served only after administrative authorization. */
export interface AcpResourceSnapshot {
  readonly options: AcpResourceOptions;
  readonly availableMemory: number | null;
  readonly problem: "storage" | null;
  readonly active: readonly (AcpResourceRecord & {
    readonly isPaused: boolean;
  })[];
  readonly waiting: readonly (AcpResourceOwner & {
    readonly since: string;
    readonly reason: AcpWaitReason;
  })[];
}

/**
 * A crash leftover of one session's GitHub credentials whose cleanup the
 * startup could not confirm; each start tries again until it succeeds.
 */
export interface AcpCredentialLeftover {
  /** The name of the directory inside the data directory, never its full path. */
  readonly directory: string;
  readonly instanceId: string;
  /**
   * `processes` while a process of the session may still run; `removal` when
   * they ended but the directory could not be removed.
   */
  readonly reason: "processes" | "removal";
}

/** What the ACP resources card shows: occupancy and the leftovers a startup could not clean up. */
export interface AcpResourceDiagnostics extends AcpResourceSnapshot {
  readonly leftovers: readonly AcpCredentialLeftover[];
}
