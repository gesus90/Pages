import { describe, expect, it, vi } from "vitest";

import {
  describePicaMobileCalendarInvitation,
  PicaMobileCalendarPush,
} from "@/backend/service/mobile/calendar/PicaMobileCalendarPush";
import { PicaMobileAutomationPush } from "@/backend/service/mobile/notifications/PicaMobileAutomationPush";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";

import type { PushRegistrationRecord } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import type { CalendarInvitationNotice } from "@/backend/service/calendar/CalendarViewer";
import type { PicaMobileCalendarPushServices } from "@/backend/service/mobile/calendar/PicaMobileCalendarPush";
import type { PicaMobilePushMessage } from "@/backend/service/mobile/notifications/PicaMobilePushSender";
import type { UserSettings } from "@/definition/Settings";

const NOTICE: CalendarInvitationNotice = {
  eventId: "event",
  title: "Planung\nQ4",
  startAt: "2026-11-16T13:30:00.000Z",
  allDay: false,
  creatorId: "anna",
  creatorName: "Anna Admin",
};

const REGISTRATION = {
  accountId: "bob",
  deviceId: "device",
  sessionId: "session",
  tokenEncrypted: "sealed",
  locale: "de",
  preview: "details",
} as unknown as PushRegistrationRecord;

function settingsOf(change: {
  readonly language?: "de" | "en";
  readonly timezone?: string | null;
  readonly calendarInvitations?: boolean;
}): UserSettings {
  return {
    ...DEFAULT_USER_SETTINGS,
    language: change.language ?? "de",
    timezone: change.timezone === undefined ? "Europe/Berlin" : change.timezone,
    notifications: {
      ...DEFAULT_USER_SETTINGS.notifications,
      calendarInvitations: change.calendarInvitations ?? true,
    },
  } as UserSettings;
}

/** A push over the real device delivery with a sender that records the messages. */
function world(options: {
  readonly settings?: Readonly<Record<string, UserSettings>>;
  readonly isPushAvailable?: boolean;
}): {
  readonly push: PicaMobileCalendarPush;
  readonly sent: PicaMobilePushMessage[];
} {
  const sent: PicaMobilePushMessage[] = [];
  const delivery = new PicaMobileAutomationPush({
    registrations: {
      listActivated: (userId) =>
        Promise.resolve([{ ...REGISTRATION, accountId: userId }]),
    },
    accounts: { isBindingValid: () => Promise.resolve(true) },
    vault: { decrypt: () => "device-token" },
    sender: {
      ready: () => Promise.resolve(true),
      send: (message) => {
        sent.push(message);
        return Promise.resolve({ kind: "sent" });
      },
    },
    instanceId: () => Promise.resolve("instance"),
    ttlSeconds: 3600,
  });
  const services: PicaMobileCalendarPushServices = {
    picaMobileNotifications: {
      isPushAvailable: () => options.isPushAvailable ?? true,
    },
    picaMobileAutomationPush: delivery,
    settingsService: {
      getUserSettings: (userId) =>
        Promise.resolve(options.settings?.[userId] ?? settingsOf({})),
    },
  };
  return {
    push: new PicaMobileCalendarPush(() => Promise.resolve(services)),
    sent,
  };
}

describe("calendar invitation texts", () => {
  it("words a timed invitation in German in the recipient's zone", () => {
    expect(
      describePicaMobileCalendarInvitation(NOTICE, {
        timeZone: "Europe/Berlin",
        language: "de",
      }),
    ).toEqual({
      title: "Einladung: Planung Q4",
      body: "Montag, 16.11.2026, 14:30 · von Anna Admin",
      start: "2026-11-16T14:30:00+01:00",
    });
  });

  it("words an invitation in English and an all-day one with its date", () => {
    const english = describePicaMobileCalendarInvitation(NOTICE, {
      timeZone: "America/New_York",
      language: "en",
    });
    expect(english.title).toBe("Invitation: Planung Q4");
    expect(english.body).toMatch(
      /^Monday, 11\/16\/2026, 8:30\sAM · from Anna Admin$/u,
    );
    expect(english.start).toBe("2026-11-16T08:30:00-05:00");
    expect(
      describePicaMobileCalendarInvitation(
        { ...NOTICE, startAt: "2026-11-16", allDay: true },
        { timeZone: "Pacific/Auckland", language: "de" },
      ),
    ).toEqual({
      title: "Einladung: Planung Q4",
      body: "Montag, 16.11.2026 · von Anna Admin",
      start: "2026-11-16",
    });
  });
});

describe("PicaMobileCalendarPush", () => {
  it("pushes every invited person but the creator on the calendar channel", async () => {
    const { push, sent } = world({
      settings: { carla: settingsOf({ language: "en", timezone: "UTC" }) },
    });
    await push.deliver(NOTICE, ["anna", "bob", "carla", "bob"]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      token: "device-token",
      title: "Einladung: Planung Q4",
      body: "Montag, 16.11.2026, 14:30 · von Anna Admin",
      data: {
        kind: "calendar_invitation",
        eventId: "event",
        start: "2026-11-16T14:30:00+01:00",
      },
      channelId: "pica-calendar-invitations",
      tag: "calendar:event",
      ttlSeconds: 3600,
    });
    expect(sent[1]).toMatchObject({
      title: "Invitation: Planung Q4",
      data: { start: "2026-11-16T13:30:00+00:00" },
    });
  });

  it("respects the setting and a missing FCM sender", async () => {
    const off = world({
      settings: { bob: settingsOf({ calendarInvitations: false }) },
    });
    await off.push.deliver(NOTICE, ["bob"]);
    expect(off.sent).toEqual([]);

    const unavailable = world({ isPushAvailable: false });
    await unavailable.push.deliver(NOTICE, ["bob"]);
    expect(unavailable.sent).toEqual([]);
  });

  it("sends in the background and never fails the invitation", async () => {
    const resolve = vi.fn(() => Promise.reject(new Error("not started")));
    const push = new PicaMobileCalendarPush(resolve);
    await expect(push.invited(NOTICE, ["bob"])).resolves.toBeUndefined();
    await vi.waitFor(() => expect(resolve).toHaveBeenCalled());
  });
});
