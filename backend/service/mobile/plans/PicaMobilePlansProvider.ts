import type {
  PicaMobileErrorCode,
  PicaMobilePlanPayload,
  PicaMobilePlanRow,
  PicaMobilePlanRunControlledPayload,
} from "@/definition/PicaMobileProtocol";
import type { PicaMobilePlanRunControlPayload } from "@/definition/PicaMobilePlanControl";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";

/**
 * The answer to a read of the plan rows.
 * @remarks
 * `sessionEnded` means the session or the account no longer holds; the
 * connection ends as it does when its regular session check fails.
 */
export type PicaMobilePlansOutcome =
  | { readonly kind: "ready"; readonly rows: readonly PicaMobilePlanRow[] }
  | { readonly kind: "sessionEnded" };

/** How the plan rows are read. */
export interface PicaMobilePlansReadOptions {
  /** Whether every row of a run carries its `state` key (`plans.flow.v1`). */
  readonly withState: boolean;
}

/** How one plan is read. */
export interface PicaMobilePlanReadOptions {
  /** Whether the run carries its `flow` (`plans.flow.v1`). */
  readonly withFlow: boolean;
}

/** The answer to a read of one plan. */
export type PicaMobilePlanOutcome =
  | { readonly kind: "ready"; readonly payload: PicaMobilePlanPayload }
  | { readonly kind: "sessionEnded" };

/**
 * Reads plans for one connection.
 * @remarks
 * A reader keeps what it checked for its connection, so a run is checked
 * again only when it changed or its last check expired. Both reads start
 * with the session and reject only when Pages cannot decide right now.
 */
export interface PicaMobilePlansReader {
  /** Reads every row of the account, unordered and not yet limited. */
  readPlans(
    session: PicaMobileSessionIdentity,
    options: PicaMobilePlansReadOptions,
  ): Promise<PicaMobilePlansOutcome>;
  /** Reads the latest own run of one plan of the account. */
  readPlan(
    session: PicaMobileSessionIdentity,
    planId: string,
    options: PicaMobilePlanReadOptions,
  ): Promise<PicaMobilePlanOutcome>;
}

/**
 * What the run control answers to one `plan_run_control`.
 * @remarks
 * `refused` carries `forbidden`, `not_found`, `conflict` or
 * `invalid_request` and a message without foreign data; a refused action
 * changed nothing. `sessionEnded` means the session or the account no longer
 * holds; the connection ends then.
 */
export type PicaMobilePlanControlOutcome =
  | {
      readonly kind: "controlled";
      readonly payload: PicaMobilePlanRunControlledPayload;
    }
  | {
      readonly kind: "refused";
      readonly code: PicaMobileErrorCode;
      readonly message: string;
      /** The revision the run has now; only for `conflict`. */
      readonly currentRevision?: number;
    }
  | { readonly kind: "sessionEnded" };

/** Pauses, resumes and stops own runs for Pica Mobile (`plans.control.v1`). */
export interface PicaMobilePlanControl {
  /** Applies one action to one own run of the account behind the session. */
  control(
    session: PicaMobileSessionIdentity,
    request: PicaMobilePlanRunControlPayload,
  ): Promise<PicaMobilePlanControlOutcome>;
}

/**
 * The business answers of an authenticated Pica Mobile connection for `plans.v1`.
 * @remarks
 * A connection without a provider does not announce `plans.v1` and answers
 * `plans_sync` and `plan_get` as unknown.
 */
export interface PicaMobilePlansProvider {
  /**
   * Controls own runs; without it the connection does not announce
   * `plans.control.v1` and answers `plan_run_control` as unknown.
   */
  readonly control?: PicaMobilePlanControl;
  /** Creates the reader of one connection. */
  open(): PicaMobilePlansReader;
  /**
   * Calls the listener whenever a run of the account may have changed in a way the rows show.
   * @returns Stops the calls.
   */
  watch(userId: string, listener: () => void): () => void;
}
