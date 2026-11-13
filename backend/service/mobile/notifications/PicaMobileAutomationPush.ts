import { logEvent } from "@/backend/logging/Logger";

import type { PushRegistrationRecord } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import type { PicaMobilePushRegistrationRepository } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import type { AutomationRunOutcome } from "@/definition/Automation";
import type { PicaMobileNotificationLocale } from "@/definition/PicaMobileNotifications";
import type { PicaMobileAccountChecks } from "./PicaMobileAccountChecks";
import type {
  PicaMobilePushMessage,
  PicaMobilePushSender,
} from "./PicaMobilePushSender";
import type { PicaMobilePushTokenVault } from "./PicaMobilePushTokenVault";

/** The finished run a person hears about. */
export interface AutomationRunNotice {
  readonly automationId: string;
  readonly automationName: string;
  readonly runId: string;
  readonly outcome: AutomationRunOutcome;
  /** ISO 8601 end of the run. */
  readonly endedAt: string;
}

/** What the push of automation runs is built from. */
export interface PicaMobileAutomationPushOptions {
  readonly registrations: Pick<
    PicaMobilePushRegistrationRepository,
    "listActivated"
  >;
  readonly accounts: PicaMobileAccountChecks;
  readonly vault: Pick<PicaMobilePushTokenVault, "decrypt">;
  /** `null` while no sender is configured: nothing is handed over then. */
  readonly sender: PicaMobilePushSender | null;
  readonly instanceId: () => Promise<string>;
  readonly ttlSeconds: number;
}

interface AutomationTexts {
  readonly hiddenTitle: string;
  readonly hiddenBody: string;
  readonly outcome: Readonly<Record<AutomationRunOutcome, string>>;
}

const TEXTS: Readonly<Record<PicaMobileNotificationLocale, AutomationTexts>> = {
  de: {
    hiddenTitle: "Automation beendet",
    hiddenBody: "Zum Anzeigen der Details entsperren.",
    outcome: {
      ok: "Erfolgreich",
      failed: "Fehlgeschlagen",
      forbidden: "Rechte fehlen",
      skipped: "Übersprungen",
    },
  },
  en: {
    hiddenTitle: "Automation finished",
    hiddenBody: "Unlock to view details.",
    outcome: {
      ok: "Succeeded",
      failed: "Failed",
      forbidden: "Missing rights",
      skipped: "Skipped",
    },
  },
};

const MAXIMUM_NAME_LENGTH = 80;

function clean(text: string): string {
  const collapsed = text
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(collapsed);
  return characters.length <= MAXIMUM_NAME_LENGTH
    ? collapsed
    : `${characters.slice(0, MAXIMUM_NAME_LENGTH - 1).join("")}…`;
}

function timeOf(endedAt: string, locale: PicaMobileNotificationLocale): string {
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(endedAt));
}

/**
 * Builds the push of a finished automation run for one device (PAGE-297).
 *
 * @remarks
 * With `details` the title names the automation and the body its result and
 * time; with `hidden` both are generic. `data` links the run in the history.
 */
export function buildAutomationPushMessage(input: {
  readonly token: string;
  readonly instanceId: string;
  readonly registration: PushRegistrationRecord;
  readonly notice: AutomationRunNotice;
  readonly ttlSeconds: number;
}): PicaMobilePushMessage {
  const { notice, registration } = input;
  const texts = TEXTS[registration.locale];
  const hasDetails = registration.preview === "details";
  const tag = `automation:${notice.automationId}`;
  return {
    token: input.token,
    title: hasDetails ? clean(notice.automationName) : texts.hiddenTitle,
    body: hasDetails
      ? `${texts.outcome[notice.outcome]} · ${timeOf(notice.endedAt, registration.locale)} UTC`
      : texts.hiddenBody,
    data: {
      pica_v: "1",
      pica_type: "automation_run",
      pica_instance: input.instanceId,
      pica_account: registration.accountId,
      pica_automation: notice.automationId,
      pica_run: notice.runId,
      pica_outcome: notice.outcome,
      pica_at: notice.endedAt,
      pica_link: `/automationen?tab=history&run=${encodeURIComponent(notice.runId)}`,
      tag,
    },
    channelId: "pica-plan-results",
    tag,
    ttlSeconds: input.ttlSeconds,
  };
}

/** One activated device a push is built for. */
export interface PicaMobilePushDevice {
  /** The confidential native token of the device; it never reaches a log. */
  readonly token: string;
  readonly instanceId: string;
  readonly registration: PushRegistrationRecord;
  readonly ttlSeconds: number;
}

/** What a push of one person names in its handover log, never its text. */
export interface PicaMobilePushLog {
  readonly event: string;
  readonly message: string;
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * Tells a person on their Pica Mobile devices about a finished automation run.
 *
 * @remarks
 * Push is the only way Pages delivers today. Without a configured sender or
 * a coupled device nothing happens: no error, no hint and no later delivery.
 * Each registration's session and account are checked before the handover,
 * which is logged without token or text. {@link deliver} hands other pushes
 * of one person the same way, such as calendar invitations (PAGE-301).
 */
export class PicaMobileAutomationPush {
  private readonly options: PicaMobileAutomationPushOptions;

  public constructor(options: PicaMobileAutomationPushOptions) {
    this.options = options;
  }

  /** Hands the push of one finished run to every activated device of the person. */
  public async notify(
    userId: string,
    notice: AutomationRunNotice,
  ): Promise<void> {
    await this.deliver(
      userId,
      (device) =>
        buildAutomationPushMessage({
          token: device.token,
          instanceId: device.instanceId,
          registration: device.registration,
          notice,
          ttlSeconds: device.ttlSeconds,
        }),
      {
        event: "pica_mobile.automation_push.handed_over",
        message: "Pica Mobile push of an automation run handed over",
        metadata: { runId: notice.runId },
      },
    );
  }

  /**
   * Hands a push to every activated device of a person.
   *
   * @param userId - The person.
   * @param build - Builds the push for one device whose binding still holds.
   * @param log - What each handover is logged as, with the outcome added.
   *
   * @remarks
   * Without a sender that is ready nothing is built or sent and nothing fails.
   */
  public async deliver(
    userId: string,
    build: (device: PicaMobilePushDevice) => PicaMobilePushMessage,
    log: PicaMobilePushLog,
  ): Promise<void> {
    const { sender } = this.options;
    if (sender === null || !(await sender.ready())) return;
    const registrations =
      await this.options.registrations.listActivated(userId);
    for (const registration of registrations) {
      if (
        !(await this.options.accounts.isBindingValid(
          userId,
          registration.sessionId,
        ))
      )
        continue;
      const token = this.options.vault.decrypt(
        registration.deviceId,
        registration.tokenEncrypted,
      );
      if (token === null) continue;
      const outcome = await sender.send(
        build({
          token,
          instanceId: await this.options.instanceId(),
          registration,
          ttlSeconds: this.options.ttlSeconds,
        }),
      );
      logEvent({
        level: "info",
        event: log.event,
        component: "PicaMobileAutomationPush",
        message: log.message,
        metadata: { ...log.metadata, userId, status: outcome.kind },
      });
    }
  }
}
