import { z } from "zod";

/** The eight phases of the guided runner setup, in the order they run. */
export const SETUP_PHASES = [
  "preflight",
  "system",
  "tools",
  "connections",
  "git",
  "verify",
  "service",
  "pairing",
] as const;

/** One phase of the guided setup. */
export type SetupPhase = (typeof SETUP_PHASES)[number];

/** Where a phase stands; `waiting` means the sequence needs a person's input. */
export const SETUP_PHASE_STATES = [
  "pending",
  "running",
  "waiting",
  "done",
  "skipped",
  "failed",
] as const;

/** The state of one phase. */
export type SetupPhaseState = (typeof SETUP_PHASE_STATES)[number];

/**
 * What Pages itself does in phase 1 before the script runs, in the order it runs.
 *
 * @remarks
 * A failed step stops every later step, so a refused host never receives the script.
 */
export const SETUP_PREPARATION_STEPS = [
  "rights",
  "connection",
  "upload",
  "verification",
  "permissions",
  "console",
  "start",
] as const;

/** One preparation step of phase 1. */
export type SetupPreparationStep = (typeof SETUP_PREPARATION_STEPS)[number];

/** How a setup run ended; only `confirmed` stands for a finished installation. */
export const SETUP_OUTCOMES = ["confirmed", "partial", "failed"] as const;

/** The end of a setup run. */
export type SetupOutcome = (typeof SETUP_OUTCOMES)[number];

/**
 * The progress of one setup run as the browser draws it.
 *
 * @remarks
 * Only the server decides the outcome: the script reports phases, but
 * `confirmed` needs the service and the pairing to be verified by Pages.
 */
export const setupProgressSchema = z.object({
  /** One state per phase, in {@link SETUP_PHASES} order. */
  phases: z.array(z.enum(SETUP_PHASE_STATES)).length(SETUP_PHASES.length),
  /** The preparation step that is running or failed; `null` once the script has started. */
  step: z.enum(SETUP_PREPARATION_STEPS).nullable(),
  outcome: z.enum(SETUP_OUTCOMES).nullable(),
  /** Translation key naming why the run stopped or is partial. */
  reason: z
    .string()
    .regex(/^remote\.(?:error|failure|console|setup)\.[a-zA-Z_.]+$/u)
    .nullable(),
});

/** The progress of a setup run. */
export type SetupProgress = z.infer<typeof setupProgressSchema>;

/** A run that has not reported anything yet. */
export const INITIAL_SETUP_PROGRESS: SetupProgress = {
  phases: SETUP_PHASES.map(() => "pending"),
  step: null,
  outcome: null,
  reason: null,
};

/**
 * What Pages knows about the runner installation of a machine.
 *
 * @remarks
 * `unknown` means no valid finding exists: none was made yet, or the host,
 * port, user or host key changed since. It is never shown as not installed.
 */
export const INSTALL_STATES = [
  "unknown",
  "not_installed",
  "running",
  "partial",
  "confirmed",
] as const;

/** The overall installation state of a connection. */
export type InstallState = (typeof INSTALL_STATES)[number];

/**
 * The service managers the setup can register the runner with, as the machine reports them.
 *
 * @remarks
 * `none` is a finding, not a gap: no systemd and no supervisord answered, so
 * nothing registers the runner and nothing restarts it.
 */
export const SERVICE_MANAGERS = ["systemd", "supervisord", "none"] as const;

/** The service manager detected on a machine. */
export type ServiceManager = (typeof SERVICE_MANAGERS)[number];

/** The command line tools the runner can drive. */
export const SETUP_TOOLS = ["codex", "claude", "opencode"] as const;

/** One of the command line tools of the setup. */
export type SetupTool = (typeof SETUP_TOOLS)[number];

/** The output modalities OpenCode states for a model. */
export const MODEL_MODALITIES = [
  "text",
  "image",
  "video",
  "audio",
  "pdf",
] as const;

/**
 * Why a runner judged the ACP contract of the installed OpenCode as it did.
 *
 * @remarks
 * `exact_version`: the version Pages verified; `contract_matches`: another
 * version whose handshake, agent identity and session selectors match;
 * the rest name the part that differs or why no check was possible.
 */
export const OPENCODE_ACP_REASONS = [
  "exact_version",
  "contract_matches",
  "agent_mismatch",
  "protocol_mismatch",
  "selectors_missing",
  "probe_failed",
] as const;

/** A tool on the machine; a version the tool did not report stays `null`, never a placeholder. */
export const toolInventorySchema = z.object({
  tool: z.enum(SETUP_TOOLS),
  /** Missing on older runners; no login is inferred from an installed binary. */
  authentication: z
    .enum(["authenticated", "not_logged_in", "unknown"])
    .optional(),
  catalogRevision: z.string().max(100).optional(),
  models: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9/~_.:+-]{1,200}$/u),
        name: z.string().max(200),
        reasoningEfforts: z.array(z.string().max(40)).max(10),
        /** OpenCode only: what it states about the model, for the global model filter. */
        status: z.string().max(40).optional(),
        outputs: z.array(z.enum(MODEL_MODALITIES)).max(5).optional(),
        toolCall: z.boolean().optional(),
        isFree: z.boolean().optional(),
      }),
    )
    .max(1000)
    .optional(),
  /** OpenCode only: the providers set up on the machine itself, such as `opencode` or `openrouter`. */
  providers: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/u))
    .max(100)
    .optional(),
  /** OpenCode only: the ACP contract check of the installed version. */
  acp: z
    .object({
      status: z.enum(["verified", "compatible", "incompatible"]),
      reason: z.enum(OPENCODE_ACP_REASONS),
    })
    .optional(),
  version: z
    .string()
    .regex(/^[A-Za-z0-9._+-]{1,40}$/u)
    .nullable(),
});

/** One entry of the tool inventory. */
export type ToolInventory = z.infer<typeof toolInventorySchema>;

/**
 * What the read-only probe observed on the machine after a connect.
 *
 * @remarks
 * `isUbuntu` and the architecture are `null` when the machine did not say.
 * `serviceManager` is the manager the probe detected; it is `null` only in a
 * finding made before the detection existed. The service booleans are the
 * answers of that manager, never the presence of a file: when the manager does
 * not answer the probe's user (`canQueryService` is false), they stay false and
 * mean "not confirmed", not "not installed".
 */
export const hostObservationSchema = z.object({
  isUbuntu: z.boolean().nullable(),
  architecture: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,20}$/u)
    .nullable(),
  serviceManager: z.enum(SERVICE_MANAGERS).nullable().default(null),
  canQueryService: z.boolean().default(false),
  isRunnerInstalled: z.boolean(),
  runnerVersion: z
    .string()
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/u)
    .nullable(),
  isServiceInstalled: z.boolean(),
  isServiceEnabled: z.boolean(),
  isServiceActive: z.boolean(),
  tools: z.array(toolInventorySchema).max(SETUP_TOOLS.length),
});

/** The facts the probe read from the machine. */
export type HostObservation = z.infer<typeof hostObservationSchema>;

/** The identity of the machine a finding belongs to; any change invalidates the finding. */
export interface InstallBinding {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly hostKeyFingerprint: string;
}

/** A stored observation with the identity it was made for. */
export interface InstallFinding {
  readonly binding: InstallBinding;
  readonly observedAt: string;
  readonly observation: HostObservation;
}

/**
 * Installed, active, autostart, paired and ready are separate facts.
 *
 * @remarks
 * A green SSH status or a copied script proves none of them. `isPaired` and
 * `isReady` come from Pages itself: a registration of the current SSH
 * configuration, and an executing runner that reported within 45 seconds.
 */
export interface InstallComponents {
  readonly isInstalled: boolean;
  /** Whether the service manager answered the query that `isActive` and `isAutostart` come from. */
  readonly isServiceQueryable: boolean;
  readonly isActive: boolean;
  readonly isAutostart: boolean;
  readonly isPaired: boolean;
  readonly isReady: boolean;
}

/** The installation state of one connection as an administrator sees it. */
export interface RemoteInstallView {
  readonly state: InstallState;
  /** The detected service manager; `null` while the state is `unknown`. */
  readonly serviceManager: ServiceManager | null;
  /** `null` while the state is `unknown`. */
  readonly components: InstallComponents | null;
  readonly runnerVersion: string | null;
  readonly observedAt: string | null;
  /** Empty while unknown; a tool the machine does not have is listed with `null`. */
  readonly tools: readonly ToolInventory[];
}
