import { PICA_MOBILE_NOTIFICATION_EVENT_TYPE } from "@/definition/PicaMobileNotifications";

import type {
  PicaMobileNotificationEventType,
  PicaMobileNotificationLocale,
} from "@/definition/PicaMobileNotifications";
import type { PicaMobilePushMessage } from "./PicaMobilePushSender";

/** The identity of an event, which every push carries as plain text. */
export interface PicaMobilePushEvent {
  readonly eventId: string;
  readonly accountId: string;
  readonly planId: string;
  readonly runId: string;
  readonly type: PicaMobileNotificationEventType;
  readonly seq: number;
  /** ISO-8601 moment the transition happened. */
  readonly occurredAt: string;
}

/** A step of a `step_started` push in the detailed form. */
export interface PicaMobilePushStep {
  readonly number: number | null;
  readonly name: string | null;
}

/**
 * The names and the reason a detailed push may show.
 *
 * @remarks
 * Only a caller that has just verified the plan ownership and the run rights
 * of the account may build it, and only for a device that registered for
 * details.
 */
export interface PicaMobilePushDetails {
  readonly planName: string;
  readonly steps: readonly PicaMobilePushStep[];
  readonly stepCount: number;
  readonly reason: string | null;
}

/** What a push is built from. */
export interface PicaMobilePushInput {
  readonly token: string;
  readonly instanceId: string;
  readonly event: PicaMobilePushEvent;
  readonly locale: PicaMobileNotificationLocale;
  /** `null` for a generic push without any name. */
  readonly details: PicaMobilePushDetails | null;
  readonly ttlSeconds: number;
}

const MAXIMUM_NAME_LENGTH = 80;
const MAXIMUM_BODY_LENGTH = 200;
const MAXIMUM_PAYLOAD_BYTES = 3_500;
const ELLIPSIS = "…";

interface EventTexts {
  /** Title of a push that names nothing. */
  readonly hiddenTitle: string;
  /** Title of a push that shows the names the device asked for. */
  readonly detailsTitle: string;
}

/** The generic text under a title that names nothing, as the contract words it. */
const GENERIC_BODY: Readonly<Record<PicaMobileNotificationLocale, string>> = {
  de: "Zum Anzeigen der Details entsperren.",
  en: "Unlock to view details.",
};

const TEXTS: Readonly<
  Record<
    PicaMobileNotificationLocale,
    Readonly<Record<PicaMobileNotificationEventType, EventTexts>>
  >
> = {
  de: {
    step_started: {
      hiddenTitle: "Agent-Plan: nächster Schritt",
      detailsTitle: "Nächster Schritt",
    },
    run_cancelled: {
      hiddenTitle: "Agent-Plan abgebrochen",
      detailsTitle: "Plan abgebrochen",
    },
    run_failed: {
      hiddenTitle: "Agent-Plan fehlgeschlagen",
      detailsTitle: "Plan fehlgeschlagen",
    },
    run_succeeded: {
      hiddenTitle: "Agent-Plan erfolgreich abgeschlossen",
      detailsTitle: "Plan erfolgreich abgeschlossen",
    },
  },
  en: {
    step_started: {
      hiddenTitle: "Agent plan: next step",
      detailsTitle: "Next step",
    },
    run_cancelled: {
      hiddenTitle: "Agent plan cancelled",
      detailsTitle: "Plan cancelled",
    },
    run_failed: {
      hiddenTitle: "Agent plan failed",
      detailsTitle: "Plan failed",
    },
    run_succeeded: {
      hiddenTitle: "Agent plan completed successfully",
      detailsTitle: "Plan completed successfully",
    },
  },
};

interface StepWords {
  readonly step: string;
  readonly manyStarted: string;
}

const STEP_WORDS: Readonly<Record<PicaMobileNotificationLocale, StepWords>> = {
  de: { step: "Schritt", manyStarted: "Schritte gestartet" },
  en: { step: "Step", manyStarted: "steps started" },
};

/** Separates the plan name from what follows it in a detailed text. */
const SEPARATOR = " · ";

/** Collapses white space, drops control characters and shortens to whole characters. */
function clean(text: string, maximum: number): string {
  const collapsed = text
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(collapsed);

  return characters.length <= maximum
    ? collapsed
    : `${characters.slice(0, maximum - 1).join("")}${ELLIPSIS}`;
}

/** `Schritt 3: Name`, `Schritt 3`, `Name` or nothing when Pages knows neither. */
function describeStep(
  step: PicaMobilePushStep,
  locale: PicaMobileNotificationLocale,
): string {
  const word = STEP_WORDS[locale].step;
  const name = step.name === null ? "" : clean(step.name, MAXIMUM_NAME_LENGTH);

  if (step.number === null) {
    return name;
  }

  return name === ""
    ? `${word} ${step.number}`
    : `${word} ${step.number}: ${name}`;
}

function stepBody(
  details: PicaMobilePushDetails,
  locale: PicaMobileNotificationLocale,
): string {
  const [first] = details.steps;

  if (first === undefined) {
    return "";
  }

  return details.stepCount <= 1
    ? describeStep(first, locale)
    : `${details.stepCount} ${STEP_WORDS[locale].manyStarted}`;
}

/** What follows the plan name: the started steps, the reason of a failure or nothing. */
function addition(
  event: PicaMobilePushEvent,
  details: PicaMobilePushDetails,
  locale: PicaMobileNotificationLocale,
): string {
  if (event.type === PICA_MOBILE_NOTIFICATION_EVENT_TYPE.STEP_STARTED) {
    return stepBody(details, locale);
  }

  return event.type === PICA_MOBILE_NOTIFICATION_EVENT_TYPE.RUN_FAILED
    ? (details.reason ?? "")
    : "";
}

/** `<plan name> · <what the event adds>`, or the plan name alone. */
function detailsBody(
  event: PicaMobilePushEvent,
  planName: string,
  details: PicaMobilePushDetails,
  locale: PicaMobileNotificationLocale,
): string {
  const text = addition(event, details, locale);

  return clean(
    text === "" ? planName : `${planName}${SEPARATOR}${text}`,
    MAXIMUM_BODY_LENGTH,
  );
}

function buildData(
  input: PicaMobilePushInput,
  tag: string,
): Record<string, string> {
  const { event } = input;

  return {
    pica_v: "1",
    pica_event: event.eventId,
    pica_instance: input.instanceId,
    pica_account: event.accountId,
    pica_type: event.type,
    pica_plan: event.planId,
    pica_run: event.runId,
    pica_seq: String(event.seq),
    pica_at: event.occurredAt,
    tag,
  };
}

function build(
  input: PicaMobilePushInput,
  details: PicaMobilePushDetails | null,
): PicaMobilePushMessage {
  const { event, locale } = input;
  const isStep =
    event.type === PICA_MOBILE_NOTIFICATION_EVENT_TYPE.STEP_STARTED;
  const tag = isStep ? `run:${event.runId}:step` : event.eventId;
  const planName =
    details === null ? "" : clean(details.planName, MAXIMUM_NAME_LENGTH);
  const hasDetails = details !== null && planName !== "";

  return {
    token: input.token,
    title: hasDetails
      ? TEXTS[locale][event.type].detailsTitle
      : TEXTS[locale][event.type].hiddenTitle,
    body: hasDetails
      ? detailsBody(event, planName, details, locale)
      : GENERIC_BODY[locale],
    data: buildData(input, tag),
    channelId: isStep ? "pica-plan-steps" : "pica-plan-results",
    tag,
    ttlSeconds: input.ttlSeconds,
  };
}

function byteLength(message: PicaMobilePushMessage): number {
  return Buffer.byteLength(
    JSON.stringify({
      title: message.title,
      body: message.body,
      data: message.data,
    }),
  );
}

/**
 * Builds the push for one event and one device.
 *
 * @param input - Event identity, language, token and, when allowed, names.
 * @returns The message, worded as `docs/PicaMobileNotifications.md` and the
 * mobile contract fix it. Without `details` the title and body are generic and
 * name nothing; with them the body reads `<plan> · <step or reason>`, each name
 * cleaned and shortened to 80 characters.
 *
 * @remarks
 * The `data` part holds only text values and the identity of the event: no
 * names, prompts, answers, logs or paths ever enter it. A progress push uses
 * the tag `run:<runId>:step`, so a newer one replaces it on the device; every
 * terminal push uses its own event identifier as tag, so none replaces
 * another and none is replaced by progress. If a detailed push would exceed
 * the size limit of the push service, the generic form is sent instead.
 */
export function buildPicaMobilePushMessage(
  input: PicaMobilePushInput,
): PicaMobilePushMessage {
  const message = build(input, input.details);

  return byteLength(message) <= MAXIMUM_PAYLOAD_BYTES
    ? message
    : build(input, null);
}
