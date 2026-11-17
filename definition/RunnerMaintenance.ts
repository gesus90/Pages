import { z } from "zod";

/** The shipped release and its immediately preceding supported release. */
export const RUNNER_RELEASE = "1.24.0";
export const RUNNER_PREVIOUS_RELEASE = "1.23.0";

/** Persisted administrator choices; a missing address inherits the public Pages address. */
export const runnerSettingsSchema = z
  .object({
    address: z.string().max(2048).nullable(),
    allowInsecureLan: z.boolean(),
    automaticUpdates: z.boolean(),
  })
  .strict();
export type RunnerSettings = z.infer<typeof runnerSettingsSchema>;

/** Bounded receipts carried only after authenticated reconciliation. */
export const runnerMaintenanceSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("maintenance"),
    sessionId: z.string().uuid(),
    runnerVersion: z.string().max(40),
    updateVersion: z.literal(1),
    status: z.enum([
      "idle",
      "deferred",
      "restarting",
      "failed",
      "verified",
      "rolled-back",
    ]),
    reason: z
      .enum([
        "active_jobs",
        "pending_receipt",
        "package_invalid",
        "exchange_failed",
        "restart_failed",
        "restart_unavailable",
      ])
      .optional(),
    targetVersion: z.string().max(40).optional(),
  })
  .strict();
export type RunnerMaintenanceReceipt = z.infer<typeof runnerMaintenanceSchema>;

/** A package contains code only, never credentials, job journals or administrator configuration. */
export interface RunnerUpdatePackage {
  readonly version: string;
  readonly sha256: string;
  readonly payload: string;
}

/** Durable operator intent and the last update receipt of the authenticated session. */
export interface RunnerMaintenanceState {
  readonly requested: boolean;
  readonly receipt: RunnerMaintenanceReceipt | null;
}

/** Server-to-runner maintenance response on the existing authenticated channel. */
export interface RunnerMaintenanceReply {
  readonly version: 1;
  readonly type: "maintenance";
  readonly sessionId: string;
  readonly endpoint: string | null;
  readonly allowInsecureLan: boolean;
  readonly update?: RunnerUpdatePackage;
}
