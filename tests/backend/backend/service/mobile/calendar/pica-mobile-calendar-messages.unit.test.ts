import { describe, expect, it } from "vitest";

import {
  encodePicaMobileCalendar,
  isPicaMobileCalendarMessage,
  isPicaMobileCalendarType,
  parsePicaMobileCalendarPayload,
  toPicaMobileCalendarEntry,
} from "@/backend/service/mobile/calendar/PicaMobileCalendarMessages";
import { readPicaMobileCapabilities } from "@/backend/service/mobile/PicaMobileCapabilities";
import { describePicaMobileFrameMismatch } from "@/backend/service/mobile/PicaMobileFrameBudget";
import { parsePicaMobileMessage } from "@/backend/service/mobile/PicaMobileMessages";

import type { PicaMobileCalendarProvider } from "@/backend/service/mobile/calendar/PicaMobileCalendarProvider";
import type { CalendarViewEntry } from "@/definition/Calendar";

const EVENT = {
  title: "Planung",
  description: "",
  start: "2026-11-16T14:00:00+01:00",
  end: "2026-11-16T15:00:00+01:00",
  allDay: false,
  calendarProjectId: null,
  invitees: [{ kind: "person", id: "bob" }],
  recurrence: null,
};

const ENTRY: CalendarViewEntry = {
  id: "event~1",
  seriesId: "event",
  occurrenceStart: "2026-11-16T14:00:00+01:00",
  title: "Planung",
  description: "",
  start: "2026-11-16T14:00:00+01:00",
  end: "2026-11-16T15:00:00+01:00",
  allDay: false,
  calendar: { kind: "personal", projectId: null, name: "Meine Termine" },
  invitees: [],
  responses: [],
  myResponse: null,
  recurrence: null,
  source: { kind: "event", ticketKey: null },
  createdBy: { id: "anna", name: "Anna" },
  editable: true,
  details: { eventId: "event", link: null, createdByMe: true },
};

describe("calendar messages", () => {
  it("recognizes the six calendar requests", () => {
    expect(isPicaMobileCalendarType("calendar_range")).toBe(true);
    expect(isPicaMobileCalendarType("calendar_targets")).toBe(true);
    expect(isPicaMobileCalendarType("speech_start")).toBe(false);
    expect(isPicaMobileCalendarMessage({ type: "calendar_invitees" })).toBe(
      true,
    );
    expect(parsePicaMobileCalendarPayload("other", "r", {})).toBeNull();
  });

  it("reads a new event and a change with its scope", () => {
    expect(
      parsePicaMobileCalendarPayload("calendar_event_save", "r", {
        ...EVENT,
        id: null,
      }),
    ).toMatchObject({
      ok: true,
      message: { type: "calendar_event_save", requestId: "r" },
    });
    expect(
      parsePicaMobileCalendarPayload("calendar_event_save", "r", {
        ...EVENT,
        id: "event~1",
        scope: "following",
      }),
    ).toMatchObject({ ok: true, message: { payload: { scope: "following" } } });
  });

  it("refuses broken payloads with invalid_request", () => {
    const refused = {
      ok: false,
      rejection: { code: "invalid_request", requestId: "r" },
    };
    expect(
      parsePicaMobileCalendarPayload("calendar_event_save", "r", {
        ...EVENT,
        id: "event",
      }),
    ).toMatchObject(refused);
    expect(
      parsePicaMobileCalendarPayload("calendar_event_save", "r", {
        ...EVENT,
        id: null,
        recurrence: { frequency: "daily", interval: 1, weekdays: ["mo"] },
      }),
    ).toMatchObject(refused);
    expect(
      parsePicaMobileCalendarPayload("calendar_event_respond", "r", {
        id: "event",
        response: "open",
      }),
    ).toMatchObject(refused);
    expect(
      parsePicaMobileCalendarPayload("calendar_range", "r", { from: "x" }),
    ).toMatchObject(refused);
  });

  it("is part of the parse chain of every frame", () => {
    const parsed = parsePicaMobileMessage(
      JSON.stringify({
        version: 1,
        type: "calendar_targets",
        requestId: "t",
        payload: {},
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      message: { type: "calendar_targets", requestId: "t", payload: {} },
    });
  });

  it("drops the details of the interface and encodes the envelope", () => {
    const entry = toPicaMobileCalendarEntry(ENTRY);
    expect(entry).not.toHaveProperty("details");
    expect(entry).toMatchObject({ id: "event~1", editable: true });
    expect(
      JSON.parse(
        encodePicaMobileCalendar(null, {
          type: "calendar_changed",
          payload: { ids: ["event"] },
        }),
      ),
    ).toEqual({
      version: 1,
      requestId: null,
      type: "calendar_changed",
      payload: { ids: ["event"] },
    });
  });

  it("lets calendar_event_save exceed 16 KiB", () => {
    expect(
      describePicaMobileFrameMismatch("calendar_event_save", {
        isLarge: true,
        kind: "message",
      }),
    ).toBeNull();
    expect(
      describePicaMobileFrameMismatch("calendar_range", {
        isLarge: true,
        kind: "message",
      }),
    ).not.toBeNull();
  });

  it("announces calendar.v1 only with a provider", async () => {
    const session = { userId: "anna", sessionToken: "token" };
    const calendar: PicaMobileCalendarProvider = {
      answer: () => Promise.resolve({ kind: "sessionEnded" }),
      follow: () => () => undefined,
      visibleChanges: () => Promise.resolve({ kind: "sessionEnded" }),
    };
    expect(await readPicaMobileCapabilities({ calendar }, session)).toContain(
      "calendar.v1",
    );
    expect(await readPicaMobileCapabilities({}, session)).not.toContain(
      "calendar.v1",
    );
  });
});
