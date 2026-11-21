import { z } from "zod";

import { PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH } from "./PicaMobileProtocol";

import type { PicaMobilePlanRunAction } from "./PicaMobileProtocol";

/** The actions of `plan_run_control`; starting a plan is deliberately none of them. */
const PICA_MOBILE_PLAN_RUN_ACTIONS = [
  "pause",
  "resume",
  "stop",
] as const satisfies readonly PicaMobilePlanRunAction[];

/**
 * A `plan_run_control` message (`plans.control.v1`): one action on one own run.
 * @remarks
 * `runId` names the run of the plan row or of `plan_get`, and
 * `expectedRevision` the revision of that run the client last saw (`revision`
 * of `run.flow`, of `plan_run_controlled` or `currentRevision` of a
 * `conflict`). Unknown fields are refused, so no other action, such as a
 * start, slips through.
 */
export const picaMobilePlanRunControlPayloadSchema = z.strictObject({
  planId: z.string().min(1).max(PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH),
  runId: z.string().min(1).max(PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH),
  action: z.enum(PICA_MOBILE_PLAN_RUN_ACTIONS),
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

/** The checked payload of `plan_run_control`. */
export type PicaMobilePlanRunControlPayload = z.infer<
  typeof picaMobilePlanRunControlPayloadSchema
>;
