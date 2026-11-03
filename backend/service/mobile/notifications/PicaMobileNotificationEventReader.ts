import { createHash } from "node:crypto";

import {
  PICA_MOBILE_MAXIMUM_EVENT_STEPS,
  PICA_MOBILE_MAXIMUM_IDENTIFIER_LENGTH,
  PICA_MOBILE_MAXIMUM_NAME_LENGTH,
  PICA_MOBILE_MAXIMUM_NOTIFICATION_FRAME_LENGTH,
  PICA_MOBILE_MAXIMUM_REASON_LENGTH,
  PICA_MOBILE_MAXIMUM_STEP_COUNT,
  PICA_MOBILE_NOTIFICATION_ENVELOPE_RESERVE,
  PICA_MOBILE_NOTIFICATION_EVENT_TYPE,
} from "@/definition/PicaMobileNotifications";

import { findStepName } from "./PicaMobileRunNames";

import type {
  PicaMobileNotificationEventRepository,
  StoredNotificationEvent,
} from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import type {
  AgentPlanOwnerRunAccess,
  AgentPlanOwnerRunReader,
} from "@/backend/service/agents/AgentPlanOwnerRunReader";
import type {
  PicaMobileNotificationEvent,
  PicaMobileNotificationEventPayload,
  PicaMobileNotificationStep,
} from "@/definition/PicaMobileNotifications";

type GrantedAccess = Extract<AgentPlanOwnerRunAccess, { status: "granted" }>;

/** Names of a shortened answer; the app counts them in UTF-16 code units, too. */
const SHORT_NAME_LENGTH = 80;

/**
 * Shortens a text to at most `maximum` UTF-16 code units, the unit the app
 * counts in, without cutting a surrogate pair in half.
 */
function limit(text: string, maximum: number): string {
  if (text.length <= maximum) {
    return text;
  }

  const cut = text.slice(0, maximum);
  const last = cut.charCodeAt(cut.length - 1);

  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * The identifier of a step instance as the app accepts it: no white space and
 * at most 200 code units. A node identifier that is not, or a loop member
 * identifier that grew too long, becomes a stable digest of itself.
 */
function opaqueInstanceId(instanceId: string): string {
  return instanceId.length <= PICA_MOBILE_MAXIMUM_IDENTIFIER_LENGTH &&
    /^\S+$/u.test(instanceId)
    ? instanceId
    : `si-${createHash("sha256").update(instanceId).digest("hex").slice(0, 32)}`;
}

function toStep(
  stored: NonNullable<StoredNotificationEvent["steps"]>[number],
  access: GrantedAccess,
): PicaMobileNotificationStep {
  const name = findStepName(access.run, stored)?.trim() ?? "";

  return {
    instanceId: opaqueInstanceId(stored.instanceId),
    number: stored.number,
    name: name === "" ? null : limit(name, PICA_MOBILE_MAXIMUM_NAME_LENGTH),
    attempt: Math.max(1, stored.attempt),
    iteration: stored.iteration,
  };
}

function toEvent(
  event: StoredNotificationEvent,
  access: GrantedAccess,
): PicaMobileNotificationEvent | null {
  const planName = access.plan.name.trim();
  const base = {
    type: event.type,
    occurredAt: event.occurredAt,
    seq: event.seq,
    plan: {
      id: access.plan.id,
      name: limit(
        planName === "" ? access.plan.id : planName,
        PICA_MOBILE_MAXIMUM_NAME_LENGTH,
      ),
    },
    // The status is read now, never the one at the time of the event.
    run: { id: event.runId, status: access.run.status },
  };

  if (event.type === PICA_MOBILE_NOTIFICATION_EVENT_TYPE.STEP_STARTED) {
    const steps = (event.steps ?? [])
      .slice(0, PICA_MOBILE_MAXIMUM_EVENT_STEPS)
      .map((step) => toStep(step, access));

    return steps.length === 0
      ? null
      : {
          ...base,
          steps,
          stepCount: Math.max(
            steps.length,
            Math.min(event.stepCount ?? 0, PICA_MOBILE_MAXIMUM_STEP_COUNT),
          ),
        };
  }

  return event.type === PICA_MOBILE_NOTIFICATION_EVENT_TYPE.RUN_FAILED
    ? {
        ...base,
        reason:
          event.reason === null
            ? null
            : limit(event.reason, PICA_MOBILE_MAXIMUM_REASON_LENGTH),
      }
    : base;
}

type OkPayload = Extract<
  PicaMobileNotificationEventPayload,
  { readonly access: "ok" }
>;

function frameLength(payload: PicaMobileNotificationEventPayload): number {
  return JSON.stringify(payload).length;
}

/**
 * Keeps an answer inside the frame the app accepts.
 *
 * @remarks
 * The app ends the connection on a frame over 16384 UTF-16 code units. Steps
 * are dropped from the end first (`stepCount` keeps the total), then the names
 * shrink; an answer that still does not fit is `gone`, never an oversized frame.
 */
function fitFrame(payload: OkPayload): PicaMobileNotificationEventPayload {
  const budget =
    PICA_MOBILE_MAXIMUM_NOTIFICATION_FRAME_LENGTH -
    PICA_MOBILE_NOTIFICATION_ENVELOPE_RESERVE;
  let current = payload;

  while (
    frameLength(current) > budget &&
    (current.event.steps?.length ?? 0) > 1
  ) {
    current = {
      ...current,
      event: {
        ...current.event,
        steps: current.event.steps?.slice(0, -1),
      },
    };
  }

  if (frameLength(current) > budget) {
    current = {
      ...current,
      event: {
        ...current.event,
        plan: {
          ...current.event.plan,
          name: limit(current.event.plan.name, SHORT_NAME_LENGTH),
        },
        steps: current.event.steps?.map((step) => ({
          ...step,
          name: step.name === null ? null : limit(step.name, SHORT_NAME_LENGTH),
        })),
      },
    };
  }

  return frameLength(current) > budget
    ? { eventId: payload.eventId, access: "gone" }
    : current;
}

/**
 * Answers `notification_event_get`: the facts of a stored event, read again
 * with the rights the account has now.
 *
 * @remarks
 * The answer is `gone` for an event that does not exist, has expired or
 * belongs to another account, and `forbidden` when the account no longer owns
 * the plan or may no longer read the run. Both carry nothing but the
 * identifier. Names and the run status come from the current authorized view
 * of the run; nothing stored earlier is shown. Pages names no link, because
 * its web interface has no address that opens one run without a query part.
 */
export class PicaMobileNotificationEventReader {
  private readonly events: Pick<PicaMobileNotificationEventRepository, "find">;
  private readonly runs: Pick<AgentPlanOwnerRunReader, "read">;

  /**
   * Creates the reader.
   *
   * @param events - The stored events.
   * @param runs - The rights check for plan ownership and run access.
   */
  public constructor(
    events: Pick<PicaMobileNotificationEventRepository, "find">,
    runs: Pick<AgentPlanOwnerRunReader, "read">,
  ) {
    this.events = events;
    this.runs = runs;
  }

  /**
   * Reads one event for an account.
   *
   * @param accountId - The authenticated account.
   * @param eventId - The event a push announced.
   * @returns The facts, or the reason there are none.
   * @throws When Pages cannot decide right now, for example on a storage
   * failure; the caller answers `server_unavailable`.
   */
  public async read(
    accountId: string,
    eventId: string,
  ): Promise<PicaMobileNotificationEventPayload> {
    const stored = await this.events.find(eventId);

    if (stored === null || stored.accountId !== accountId) {
      return { eventId, access: "gone" };
    }

    const access = await this.runs.read(accountId, stored.runId);

    if (access.status !== "granted") {
      return {
        eventId,
        access: access.status === "gone" ? "gone" : "forbidden",
      };
    }

    const event = toEvent(stored, access);

    return event === null
      ? { eventId, access: "gone" }
      : fitFrame({ eventId, access: "ok", event });
  }
}
