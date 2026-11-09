import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  PICA_MOBILE_ERROR_CODE,
  PICA_MOBILE_MAXIMUM_PLANS_FRAME_LENGTH,
} from "@/definition/PicaMobileProtocol";

import { encodePicaMobilePlans } from "../PicaMobileMessages";
import { encodePlanWithinLimit } from "./PicaMobilePlanFrame";
import { diffPlanRows, selectPlanRows } from "./PicaMobilePlanRows";

import type {
  PicaMobilePlanRow,
  PicaMobilePlansPayload,
} from "@/definition/PicaMobileProtocol";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type {
  PicaMobilePlansClientMessage,
  PicaMobileRejection,
} from "../PicaMobileMessages";
import type {
  PicaMobilePlansProvider,
  PicaMobilePlansReader,
} from "./PicaMobilePlansProvider";

/** What the handler needs from the connection it works for. */
export interface PicaMobilePlansHost {
  /** The account and session of the connection; `null` before authentication. */
  session(): PicaMobileSessionIdentity | null;
  /** Whether the connection still accepts answers. */
  isOpen(): boolean;
  /** Hands a frame to the socket; `false` when that failed. */
  send(frame: string): boolean;
  reject(rejection: PicaMobileRejection): void;
  rejectUnauthenticated(requestId: string): void;
  /** Notes a successful answer, which resets the count of rejections in a row. */
  acknowledge(): void;
  endSession(requestId: string | null): void;
  reportFailure(requestId: string, error: unknown): void;
  /**
   * Runs work behind the messages of the connection, one after another with
   * them, without counting against its message limits.
   */
  enqueue(task: () => Promise<void>): void;
}

/** A `plans` frame ready to send, with the state the connection holds once it is out. */
interface ComposedPlans {
  readonly frame: string;
  readonly seq: number;
  readonly rows: readonly PicaMobilePlanRow[];
}

const COMPONENT = "PicaMobilePlansHandler";
const PUSH_DELAY_MILLISECONDS = 300;

type SyncMessage = Extract<
  PicaMobilePlansClientMessage,
  { readonly type: "plans_sync" }
>;
type PlanMessage = Extract<
  PicaMobilePlansClientMessage,
  { readonly type: "plan_get" }
>;

/** The rows to leave out so a frame that is `excess` code units too long can fit. */
function rowsToDrop(
  rows: readonly PicaMobilePlanRow[],
  excess: number,
): number {
  let dropped = 0;
  let saved = 0;

  while (dropped < rows.length && saved < excess) {
    dropped += 1;
    saved += JSON.stringify(rows[rows.length - dropped]).length;
  }

  return Math.max(dropped, 1);
}

/**
 * Answers `plans.v1` for one connection and sends its changes on its own.
 *
 * @remarks
 * The handler keeps the `seq` of the connection and the rows it sent last, so
 * an answer to `plans_sync` and a change Pages sends on its own come from
 * the same comparison and nothing is sent twice. After the first answered
 * `plans_sync` it follows the runs of the account: a change waits 300
 * milliseconds for more and then queues one read behind the messages of the
 * connection, with at most one such read running and one waiting. A change
 * without any difference in the rows sends nothing. The rows carry their
 * `state` key only while the latest `plans_sync` asked for `flow`; the
 * change is compared against the rows as they were sent, so switching it
 * sends the keys as changed fields.
 */
export class PicaMobilePlansHandler {
  private readonly provider: PicaMobilePlansProvider | undefined;
  private readonly host: PicaMobilePlansHost;
  private readonly reader: PicaMobilePlansReader | null;
  private seq = 0;
  private sent = new Map<string, PicaMobilePlanRow>();
  private withState = false;
  private stopWatching: (() => void) | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private isPushWaiting = false;
  private isStopped = false;

  /**
   * Creates the handler.
   *
   * @param provider - The business answers; none: the messages are unknown.
   * @param host - The connection the handler answers on.
   */
  public constructor(
    provider: PicaMobilePlansProvider | undefined,
    host: PicaMobilePlansHost,
  ) {
    this.provider = provider;
    this.host = host;
    this.reader = provider?.open() ?? null;
  }

  /**
   * Handles one message of `plans.v1`.
   *
   * @param message - A message that passed every check of its payload.
   */
  public async handle(message: PicaMobilePlansClientMessage): Promise<void> {
    const { host, provider, reader } = this;

    // A request queued behind a message that ended the connection is moot.
    if (!host.isOpen()) {
      return;
    }

    if (provider === undefined || reader === null) {
      host.reject({
        code: PICA_MOBILE_ERROR_CODE.UNKNOWN_TYPE,
        message: "The message type is not known.",
        requestId: message.requestId,
      });

      return;
    }

    const session = host.session();

    if (session === null) {
      host.rejectUnauthenticated(message.requestId);

      return;
    }

    try {
      await (message.type === "plans_sync"
        ? this.answerSync(provider, reader, session, message)
        : this.answerPlan(reader, session, message));
    } catch (error: unknown) {
      // The rows the connection holds stay as they are; the next sync compares against them.
      logCaughtError(COMPONENT, error);

      host.reportFailure(message.requestId, error);
    }
  }

  /** Releases the timer and stops following the runs; nothing is sent afterwards. */
  public stop(): void {
    this.isStopped = true;

    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }

    this.stopWatching?.();
    this.stopWatching = null;
  }

  private async answerSync(
    provider: PicaMobilePlansProvider,
    reader: PicaMobilePlansReader,
    session: PicaMobileSessionIdentity,
    message: SyncMessage,
  ): Promise<void> {
    const withState = message.payload.flow === true;
    const outcome = await reader.readPlans(session, { withState });

    if (!this.host.isOpen()) {
      return;
    }

    if (outcome.kind === "sessionEnded") {
      this.host.endSession(message.requestId);

      return;
    }

    const isFull =
      message.payload.since === null || message.payload.since !== this.seq;

    this.withState = withState;

    const composed = this.compose(outcome.rows, {
      requestId: message.requestId,
      isFull,
    });

    this.host.acknowledge();

    if (composed === null) {
      this.host.send(
        encodePicaMobilePlans(message.requestId, { seq: this.seq }),
      );
    } else if (this.host.send(composed.frame)) {
      this.commit(composed);
    }

    this.stopWatching ??= provider.watch(session.userId, () =>
      this.schedulePush(),
    );
  }

  private async answerPlan(
    reader: PicaMobilePlansReader,
    session: PicaMobileSessionIdentity,
    message: PlanMessage,
  ): Promise<void> {
    const outcome = await reader.readPlan(session, message.payload.planId, {
      withFlow: message.payload.flow === true,
    });

    if (!this.host.isOpen()) {
      return;
    }

    if (outcome.kind === "sessionEnded") {
      this.host.endSession(message.requestId);

      return;
    }

    const frame = encodePlanWithinLimit(message.requestId, outcome.payload);

    if (frame === null) {
      logEvent({
        level: "warn",
        event: "pica_mobile.plan.too_large",
        component: COMPONENT,
        message: "A Pica Mobile plan answer exceeds the frame limit",
      });
      this.host.reject({
        code: PICA_MOBILE_ERROR_CODE.SERVER_UNAVAILABLE,
        message: "Pages cannot deliver this plan.",
        requestId: message.requestId,
      });

      return;
    }

    this.host.acknowledge();
    this.host.send(frame);
  }

  /** Bundles the run changes of 300 milliseconds into one read. */
  private schedulePush(): void {
    if (this.isStopped || this.pushTimer !== null) {
      return;
    }

    this.pushTimer = setTimeout(
      () => this.queuePush(),
      PUSH_DELAY_MILLISECONDS,
    );
    this.pushTimer.unref();
  }

  private queuePush(): void {
    this.pushTimer = null;

    // A waiting read will see this change too.
    if (this.isStopped || this.isPushWaiting) {
      return;
    }

    this.isPushWaiting = true;
    this.host.enqueue(async () => {
      this.isPushWaiting = false;
      await this.push();
    });
  }

  private async push(): Promise<void> {
    const session = this.host.session();

    if (
      this.isStopped ||
      !this.host.isOpen() ||
      session === null ||
      this.reader === null
    ) {
      return;
    }

    let outcome: Awaited<ReturnType<PicaMobilePlansReader["readPlans"]>>;

    try {
      outcome = await this.reader.readPlans(session, {
        withState: this.withState,
      });
    } catch (error: unknown) {
      // The next plans_sync of the app catches up; nothing is sent now.
      logEvent({
        level: "warn",
        event: "pica_mobile.plans.push_failed",
        component: COMPONENT,
        message: "Pica Mobile plan rows could not be read for a change",
        error,
      });

      return;
    }

    if (this.isStopped || !this.host.isOpen()) {
      return;
    }

    if (outcome.kind === "sessionEnded") {
      this.host.endSession(null);

      return;
    }

    const composed = this.compose(outcome.rows, {
      requestId: null,
      isFull: false,
    });

    if (composed !== null && this.host.send(composed.frame)) {
      this.commit(composed);
    }
  }

  /**
   * Builds the next `plans` frame within the frame limit.
   *
   * @returns `null` for a change without any difference.
   *
   * @remarks
   * Rows of the lowest order leave until the frame fits; a row the connection
   * held before is then removed like any row beyond the row limit.
   */
  private compose(
    rows: readonly PicaMobilePlanRow[],
    options: { readonly requestId: string | null; readonly isFull: boolean },
  ): ComposedPlans | null {
    let selected = selectPlanRows(rows);

    for (;;) {
      const payload = this.payload(selected, options.isFull);

      if (payload === null) {
        return null;
      }

      const frame = encodePicaMobilePlans(options.requestId, payload);
      const excess = frame.length - PICA_MOBILE_MAXIMUM_PLANS_FRAME_LENGTH;

      if (excess <= 0 || selected.length === 0) {
        return { frame, seq: payload.seq, rows: selected };
      }

      selected = selected.slice(0, -rowsToDrop(selected, excess));
    }
  }

  private payload(
    selected: readonly PicaMobilePlanRow[],
    isFull: boolean,
  ): PicaMobilePlansPayload | null {
    const seq = this.seq + 1;

    if (isFull) {
      return { seq, full: true, plans: selected };
    }

    const { plans, removed } = diffPlanRows(this.sent, selected);

    if (plans.length === 0 && removed.length === 0) {
      return null;
    }

    return {
      seq,
      ...(plans.length === 0 ? {} : { plans }),
      ...(removed.length === 0 ? {} : { removed }),
    };
  }

  private commit(composed: ComposedPlans): void {
    this.seq = composed.seq;
    this.sent = new Map(composed.rows.map((row) => [row.id, row]));
  }
}
