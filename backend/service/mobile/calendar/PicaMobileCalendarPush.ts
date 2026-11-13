import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  formatInZone,
  isKnownTimeZone,
  serverTimeZone,
} from "@/backend/service/calendar/CalendarTime";
import { LANGUAGE } from "@/language/Language";

import type {
  CalendarInvitationListener,
  CalendarInvitationNotice,
} from "@/backend/service/calendar/CalendarViewer";
import type { SettingsService } from "@/backend/service/SettingsService";
import type { Language } from "@/language/Language";
import type { PicaMobileNotificationService } from "../notifications/PicaMobileNotificationService";
import type {
  PicaMobileAutomationPush,
  PicaMobilePushDevice,
} from "../notifications/PicaMobileAutomationPush";
import type { PicaMobilePushMessage } from "../notifications/PicaMobilePushSender";

/** The Pages services the push of invitations is sent with. */
export interface PicaMobileCalendarPushServices {
  /** Tells whether an FCM sender is configured at all. */
  readonly picaMobileNotifications: Pick<
    PicaMobileNotificationService,
    "isPushAvailable"
  >;
  /** Hands a push to every activated device of a person. */
  readonly picaMobileAutomationPush: Pick<PicaMobileAutomationPush, "deliver">;
  readonly settingsService: Pick<SettingsService, "getUserSettings">;
}

/** The texts of one invitation push for one recipient. */
export interface PicaMobileCalendarInvitationTexts {
  readonly title: string;
  readonly body: string;
  /** Start in the recipient's zone with offset, or the date of an all-day event. */
  readonly start: string;
}

const COMPONENT = "PicaMobileCalendarPush";
const MAXIMUM_NAME_LENGTH = 80;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const WORDS: Readonly<
  Record<Language, { readonly title: string; readonly from: string }>
> = {
  de: { title: "Einladung", from: "von" },
  en: { title: "Invitation", from: "from" },
};

/** Collapses white space, drops control characters and shortens to whole characters. */
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

/** `Montag, 16.11.2026, 14:30` or `Monday, 11/16/2026, 2:30 PM`; dates only for all-day events. */
function describeStart(
  notice: Pick<CalendarInvitationNotice, "startAt" | "allDay">,
  timeZone: string,
  language: Language,
): { readonly text: string; readonly start: string } {
  const locale = language === LANGUAGE.ENGLISH ? "en-US" : "de-DE";
  const date = notice.startAt.slice(0, 10);
  if (notice.allDay || DATE_PATTERN.test(notice.startAt)) {
    const text = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));
    return { text, start: date };
  }
  const instant = Date.parse(notice.startAt);
  const text = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(instant));
  return { text, start: formatInZone(instant, timeZone) };
}

/**
 * Words the push of an invitation for one recipient.
 *
 * @param notice - The event and its creator.
 * @param recipient - Zone and language of the recipient's Pages settings.
 * @returns Title `Einladung: <Titel>`, body `<Wochentag, Datum, Zeit> · von
 * <Ersteller>` (English: `Invitation: …`, `… · from …`) and the start.
 */
export function describePicaMobileCalendarInvitation(
  notice: CalendarInvitationNotice,
  recipient: { readonly timeZone: string; readonly language: Language },
): PicaMobileCalendarInvitationTexts {
  const words = WORDS[recipient.language];
  const when = describeStart(notice, recipient.timeZone, recipient.language);
  return {
    title: `${words.title}: ${clean(notice.title)}`,
    body: `${when.text} · ${words.from} ${clean(notice.creatorName)}`,
    start: when.start,
  };
}

/**
 * Builds the invitation push for one device.
 *
 * @param device - Token and validity of the device.
 * @param eventId - The event the recipient is invited to.
 * @param texts - Title, body and start for the recipient.
 * @returns The push on the channel `pica-calendar-invitations`, tagged by the
 * event, whose `data` holds only `kind`, `eventId` and `start`.
 */
export function buildPicaMobileCalendarPushMessage(
  device: PicaMobilePushDevice,
  eventId: string,
  texts: PicaMobileCalendarInvitationTexts,
): PicaMobilePushMessage {
  return {
    token: device.token,
    title: texts.title,
    body: texts.body,
    data: { kind: "calendar_invitation", eventId, start: texts.start },
    channelId: "pica-calendar-invitations",
    tag: `calendar:${eventId}`,
    ttlSeconds: device.ttlSeconds,
  };
}

/**
 * Pushes new invitations of the calendar to the Pica Mobile devices of the
 * invited accounts (PAGE-301).
 *
 * @remarks
 * The creator never receives a push, nor does an account that switched off
 * `notifications.calendarInvitations`. Every push is worded in the zone and
 * language of its recipient. Without a configured FCM sender nothing is sent
 * and nothing fails. The pushes go out in the background, so the change that
 * invited does not wait for the push service, and a failing push never
 * undoes it.
 */
export class PicaMobileCalendarPush implements CalendarInvitationListener {
  private readonly resolveServices: () => Promise<PicaMobileCalendarPushServices>;

  /**
   * Creates the push.
   *
   * @param resolveServices - Resolves the notification services when an
   * invitation goes out; they start after the calendar.
   */
  public constructor(
    resolveServices: () => Promise<PicaMobileCalendarPushServices>,
  ) {
    this.resolveServices = resolveServices;
  }

  /** Starts the pushes of a new invitation in the background. */
  public invited(
    notice: CalendarInvitationNotice,
    userIds: readonly string[],
  ): Promise<void> {
    void withBackgroundDatabaseWork("pica_mobile_calendar_push", () =>
      this.deliver(notice, userIds),
    ).catch((error: unknown) => {
      logCaughtError(COMPONENT, error);
    });
    return Promise.resolve();
  }

  /**
   * Hands the pushes of one invitation to the devices of its recipients.
   *
   * @param notice - The event and its creator.
   * @param userIds - The newly invited accounts.
   */
  public async deliver(
    notice: CalendarInvitationNotice,
    userIds: readonly string[],
  ): Promise<void> {
    const recipients = [...new Set(userIds)].filter(
      (userId) => userId !== notice.creatorId,
    );
    if (recipients.length === 0) return;
    const services = await this.resolveServices();
    if (!services.picaMobileNotifications.isPushAvailable()) return;
    for (const userId of recipients) {
      try {
        await this.deliverTo(services, notice, userId);
      } catch (error: unknown) {
        logCaughtError(COMPONENT, error);
      }
    }
  }

  private async deliverTo(
    services: PicaMobileCalendarPushServices,
    notice: CalendarInvitationNotice,
    userId: string,
  ): Promise<void> {
    const settings = await services.settingsService.getUserSettings(userId);
    if (!settings.notifications.calendarInvitations) return;
    const timeZone =
      settings.timezone !== null && isKnownTimeZone(settings.timezone)
        ? settings.timezone
        : serverTimeZone();
    const texts = describePicaMobileCalendarInvitation(notice, {
      timeZone,
      language: settings.language,
    });
    await services.picaMobileAutomationPush.deliver(
      userId,
      (device) => buildPicaMobileCalendarPushMessage(device, notice.eventId, texts),
      {
        event: "pica_mobile.calendar_push.handed_over",
        message: "Pica Mobile push of a calendar invitation handed over",
        metadata: { kind: "calendar_invitation" },
      },
    );
  }
}
