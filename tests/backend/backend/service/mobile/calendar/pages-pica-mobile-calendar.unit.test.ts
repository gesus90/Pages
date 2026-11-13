import { describe, expect, it, vi } from "vitest";

import { CalendarError } from "@/backend/error/CalendarError";
import {
  isPicaMobileCalendarEvent,
  PagesPicaMobileCalendar,
} from "@/backend/service/mobile/calendar/PagesPicaMobileCalendar";

import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { PicaMobileCalendarServices } from "@/backend/service/mobile/calendar/PagesPicaMobileCalendar";
import type { CalendarViewEntry } from "@/definition/Calendar";
import type { PicaMobileCalendarRequest } from "@/definition/PicaMobileCalendar";
import type { User } from "@/definition/User";

const SESSION = { userId: "anna", sessionToken: "token" };
const USER: User = {
  id: "anna",
  username: "anna",
  displayName: "Anna",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const ENTRY: CalendarViewEntry = {
  id: "event",
  seriesId: null,
  occurrenceStart: null,
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
const FIELDS = {
  title: "Planung",
  description: "Text",
  start: "2026-11-16T14:00:00+01:00",
  end: "2026-11-16T15:00:00+01:00",
  allDay: false,
  calendarProjectId: null,
  invitees: [{ kind: "person" as const, id: "bob" }],
  recurrence: null,
};

function services(user: User | null = USER): {
  readonly provider: PagesPicaMobileCalendar;
  readonly resolved: PicaMobileCalendarServices;
  readonly listeners: ((event: PagesEvent) => void)[];
} {
  const listeners: ((event: PagesEvent) => void)[] = [];
  const resolved: PicaMobileCalendarServices = {
    authService: { getAuthenticatedUser: vi.fn(() => Promise.resolve(user)) },
    calendarService: {
      readRange: vi.fn(() =>
        Promise.resolve({
          from: "2026-11-01",
          to: "2026-11-30",
          timeZone: "Europe/Berlin",
          entries: [ENTRY],
        }),
      ),
      create: vi.fn(() => Promise.resolve(ENTRY)),
      update: vi.fn(() => Promise.resolve(ENTRY)),
      delete: vi.fn(() => Promise.resolve({ eventId: "event" })),
      respond: vi.fn(() => Promise.resolve(ENTRY)),
      searchInvitees: vi.fn(() =>
        Promise.resolve([{ kind: "person" as const, id: "bob", name: "Bob" }]),
      ),
      targets: vi.fn(() =>
        Promise.resolve([{ projectId: null, name: "Meine Termine" }]),
      ),
      isAffected: vi.fn(
        (actor: User, id: string) => (
          void actor,
          Promise.resolve(id !== "hidden")
        ),
      ),
    },
    liveChangeAudience: {
      notice: vi.fn(
        (actor: User, event: PagesEvent) => (
          void actor,
          Promise.resolve(
            event.id === "hidden"
              ? null
              : { kind: "ticket" as const, id: event.id },
          )
        ),
      ),
    },
    pagesEventPublisher: {
      subscribe: (listener) => {
        listeners.push(listener);
        return () => {
          listeners.splice(listeners.indexOf(listener), 1);
        };
      },
    },
  };
  return {
    provider: new PagesPicaMobileCalendar(() => Promise.resolve(resolved)),
    resolved,
    listeners,
  };
}

describe("PagesPicaMobileCalendar", () => {
  it("reads a range without the details of the interface", async () => {
    const { provider, resolved } = services();
    const outcome = await provider.answer(SESSION, {
      type: "calendar_range",
      payload: { from: "2026-11-01", to: "2026-11-30" },
    });
    expect(resolved.calendarService.readRange).toHaveBeenCalledWith(USER, {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(outcome).toMatchObject({
      kind: "answer",
      answer: { type: "calendar", payload: { timeZone: "Europe/Berlin" } },
    });
    if (outcome.kind !== "answer" || outcome.answer.type !== "calendar")
      throw new Error("no range");
    expect(outcome.answer.payload.entries[0]).not.toHaveProperty("details");
  });
});

describe("PagesPicaMobileCalendar", () => {
  it("creates without an id and updates with id and scope", async () => {
    const { provider, resolved } = services();
    await provider.answer(SESSION, {
      type: "calendar_event_save",
      payload: { ...FIELDS, id: null, scope: "all" },
    });
    expect(resolved.calendarService.create).toHaveBeenCalledWith(USER, FIELDS);
    const outcome = await provider.answer(SESSION, {
      type: "calendar_event_save",
      payload: { ...FIELDS, id: "event~k", scope: "following" },
    });
    expect(resolved.calendarService.update).toHaveBeenCalledWith(
      USER,
      { id: "event~k", scope: "following" },
      FIELDS,
    );
    expect(outcome).toMatchObject({
      answer: { type: "calendar_event", payload: { entry: { id: "event" } } },
    });
  });
});

describe("PagesPicaMobileCalendar", () => {
  it("deletes, responds, searches and lists targets", async () => {
    const { provider, resolved } = services();
    const requests: PicaMobileCalendarRequest[] = [
      {
        type: "calendar_event_delete",
        payload: { id: "event~k", scope: "this" },
      },
      {
        type: "calendar_event_respond",
        payload: { id: "event", response: "declined" },
      },
      { type: "calendar_invitees", payload: { query: "bo" } },
      { type: "calendar_targets", payload: {} },
    ];
    const answers = await Promise.all(
      requests.map((request) => provider.answer(SESSION, request)),
    );
    expect(
      answers.map((outcome) => outcome.kind === "answer" && outcome.answer),
    ).toEqual([
      { type: "calendar_event_deleted", payload: { id: "event~k" } },
      expect.objectContaining({ type: "calendar_event" }),
      {
        type: "calendar_invitee_options",
        payload: { options: [{ kind: "person", id: "bob", name: "Bob" }] },
      },
      {
        type: "calendar_target_options",
        payload: { targets: [{ projectId: null, name: "Meine Termine" }] },
      },
    ]);
    expect(resolved.calendarService.searchInvitees).toHaveBeenCalledWith(
      USER,
      "bo",
      20,
    );
    expect(resolved.calendarService.respond).toHaveBeenCalledWith(
      USER,
      "event",
      "declined",
    );
  });
});

describe("PagesPicaMobileCalendar", () => {
  it("maps calendar refusals and ends ended sessions", async () => {
    const targets: PicaMobileCalendarRequest = {
      type: "calendar_targets",
      payload: {},
    };
    for (const [code, expected] of [
      ["forbidden", "forbidden"],
      ["not_found", "not_found"],
      ["invalid_request", "invalid_request"],
      ["conflict", "invalid_request"],
      ["too_large", "invalid_request"],
    ] as const) {
      const { provider, resolved } = services();
      vi.mocked(resolved.calendarService.targets).mockRejectedValue(
        new CalendarError(code, "Refused."),
      );
      expect(await provider.answer(SESSION, targets)).toEqual({
        kind: "refused",
        code: expected,
        message: "Refused.",
      });
    }
    const failing = services();
    vi.mocked(failing.resolved.calendarService.targets).mockRejectedValue(
      new Error("db"),
    );
    await expect(failing.provider.answer(SESSION, targets)).rejects.toThrow(
      "db",
    );
    expect(await services(null).provider.answer(SESSION, targets)).toEqual({
      kind: "sessionEnded",
    });
  });
});

describe("PagesPicaMobileCalendar", () => {
  it("names only the visible changes", async () => {
    const { provider } = services();
    expect(
      await provider.visibleChanges(SESSION, [
        { type: "calendar.changed", id: "event" },
        { type: "calendar.changed", id: "hidden" },
        { type: "ticket.updated", id: "t1" },
        { type: "ticket.updated", id: "hidden" },
        { type: "milestone.changed", id: "m1" },
      ]),
    ).toEqual({ kind: "changes", ids: ["event", "due:t1", "milestone:m1"] });
    expect(
      await services(null).provider.visibleChanges(SESSION, [
        { type: "calendar.changed", id: "event" },
      ]),
    ).toEqual({ kind: "sessionEnded" });
  });
});

describe("PagesPicaMobileCalendar", () => {
  it("follows only events that change entries", async () => {
    const { provider, listeners } = services();
    const heard: PagesEvent[] = [];
    const stop = provider.follow((event) => heard.push(event));
    await vi.waitFor(() => expect(listeners).toHaveLength(1));
    listeners[0]?.({ type: "wiki.page.updated", id: "w" });
    listeners[0]?.({ type: "calendar.changed", id: "event" });
    expect(heard).toEqual([{ type: "calendar.changed", id: "event" }]);
    stop();
    expect(listeners).toHaveLength(0);
    expect(
      isPicaMobileCalendarEvent({ type: "milestone.created", id: "m" }),
    ).toBe(true);
    expect(
      isPicaMobileCalendarEvent({ type: "conversation.changed", id: "c" }),
    ).toBe(false);
  });
});
