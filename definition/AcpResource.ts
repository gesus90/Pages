/** Absolute admission ceiling, including the configured unlimited mode. */
export const MAX_ACP_SESSIONS = 999;

/** Accepts only numeric, whole instance limits; zero means unlimited up to the ceiling. */
export function isAcpSessionLimit(input: unknown): input is number {
  return (
    typeof input === "number" &&
    Number.isInteger(input) &&
    input >= 0 &&
    input <= MAX_ACP_SESSIONS
  );
}

/** Parses decimal form or environment text without accepting empty, fractional or coercible strings. */
export function parseAcpSessionLimit(input: unknown): number | null {
  const candidate =
    typeof input === "string" && /^\d+$/u.test(input.trim())
      ? Number(input.trim())
      : input;
  return isAcpSessionLimit(candidate) ? candidate : null;
}

export type AcpResourceLimitSource = "default" | "config" | "environment";

/** Limits for native ACP processes; memory and idle duration use MiB and milliseconds. */
export interface AcpResourceOptions {
  /** Zero uses the absolute ceiling instead of disabling admission. */
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
  readonly provider: "codex_cli" | "claude_code" | "opencode" | "antigravity";
  readonly runId: string | null;
  readonly stepId: string | null;
}

export type AcpResourceState =
  "starting" | "running" | "idle" | "closing" | "cleanup_failed";

/** Durable reservation: even a starting or uncertain process owns capacity. */
export interface AcpResourceRecord extends AcpResourceOwner {
  readonly state: AcpResourceState;
  readonly since: string;
  /** Directly spawned PID namespace supervisor, when durably registered. */
  readonly namespace?: AcpNamespaceOwner | null;
}

/** Kernel identity of a directly spawned namespace supervisor. */
export interface AcpNamespaceOwner {
  readonly pid: number;
  readonly uid: number;
  readonly start: number;
  readonly boot: string;
  /** A systemd unit, when the supervisor was launched through the manager. */
  readonly unit?: string;
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
  readonly limitSource: AcpResourceLimitSource;
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

/** A limit is acknowledged only after persistence and application to the shared scheduler. */
export type AcpResourceUpdateResult =
  | { readonly ok: true; readonly resources: AcpResourceSnapshot }
  | {
      readonly ok: false;
      readonly error: "invalidSetting" | "environmentOverride" | "general";
    };

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
