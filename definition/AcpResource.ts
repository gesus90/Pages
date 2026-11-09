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

/** Limits for native ACP processes; memory uses MiB. */
export interface AcpResourceOptions {
  /** Zero uses the absolute ceiling instead of disabling admission. */
  readonly maxConcurrentAcpSessions: number;
  readonly memoryAwareScheduling: boolean;
  readonly minimumAvailableMemory: number;
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

/**
 * What Pages durably knows about the native process creation of a lease (PAGE-264).
 *
 * @remarks
 * `reserved`: no process creation was attempted yet. `spawning`: process
 * creation began, recorded before the spawn. `not_spawned`: the start ended
 * in this server process before any process creation. `process`: the
 * process identity was captured. `null` marks a lease from before PAGE-264
 * without such evidence.
 */
export type AcpLeaseLifecycle =
  "reserved" | "spawning" | "not_spawned" | "process";

/** Reasons of the periodic check that release a reservation. */
export const ACP_RELEASE_REASONS = [
  "not_spawned",
  "previous_boot",
  "namespace_ended",
  "owner_released",
] as const;

/** Reasons of the periodic check that keep a reservation, each with its own safe next step. */
export const ACP_RETAIN_REASONS = [
  "process_alive",
  "unit_active",
  "owner_managed",
  "owner_unverified",
  "start_unconfirmed",
  "start_interrupted",
  "legacy_unproven",
  "check_failed",
] as const;

/** Why the periodic check released or kept an unconfirmed reservation. */
export type AcpLeaseCheckReason =
  (typeof ACP_RELEASE_REASONS)[number] | (typeof ACP_RETAIN_REASONS)[number];

/** The last periodic check of one kept reservation. */
export interface AcpLeaseCheck {
  readonly reason: AcpLeaseCheckReason;
  readonly at: string;
}

/** Durable reservation: even a starting or uncertain process owns capacity. */
export interface AcpResourceRecord extends AcpResourceOwner {
  readonly state: AcpResourceState;
  readonly since: string;
  /** Directly spawned PID namespace supervisor, when durably registered. */
  readonly namespace?: AcpNamespaceOwner | null;
  readonly lifecycle?: AcpLeaseLifecycle | null;
  readonly check?: AcpLeaseCheck | null;
}

/** Recovery owns plan or chat leases separately when the engine runs outside the API. */
export type AcpRecoveryScope = "all" | "plans" | "chat";

/**
 * Process activity behind a reservation: `confirmed` only for a live session
 * or a proven process, `none` before any process creation, otherwise `unknown`.
 */
export type AcpLeaseProcess = "confirmed" | "none" | "unknown";

/** Result headline of a periodic check cycle. */
export type AcpLeaseCheckOutcome =
  "pending" | "checked" | "released" | "unconfirmed" | "failed";

/** The periodic, model-free reservation check of this service process. */
export interface AcpLeaseCheckSummary {
  readonly scope: AcpRecoveryScope;
  readonly intervalMinutes: number;
  readonly lastAt: string | null;
  readonly nextAt: string | null;
  readonly outcome: AcpLeaseCheckOutcome;
  readonly checked: number;
  readonly released: number;
  readonly unconfirmed: number;
  readonly failed: number;
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
  /** Absent where a service has no periodic check, such as in a client-side preview. */
  readonly check?: AcpLeaseCheckSummary;
  readonly active: readonly (AcpResourceRecord & {
    readonly isPaused: boolean;
    /** Absent means `unknown`. */
    readonly process?: AcpLeaseProcess;
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
  /** Readable plan names of the runs that hold reservations. */
  readonly runs?: readonly AcpResourceRunReference[];
}

/** The plan run behind a reservation, as shown to administrators. */
export interface AcpResourceRunReference {
  readonly runId: string;
  readonly planId: string;
  readonly planName: string;
  readonly startedAt: string;
  readonly status: string;
}
