import { describe, expect, it } from "vitest";

import {
  addMonths,
  isCalendarDate,
  isoWeekNumber,
  monthGridDates,
  shiftAnchor,
  visibleRange,
} from "@/app/components/calendar/calendar-dates";
import {
  draftForNew,
  draftFromEntry,
  fieldsOfDraft,
  patchOfDraft,
} from "@/app/components/calendar/calendar-event-draft";
import {
  entriesOfDay,
  firstScrollMinute,
  layoutDay,
} from "@/app/components/calendar/calendar-layout";
import {
  recurrenceOf,
  repeatFieldsOf,
} from "@/app/components/calendar/calendar-recurrence";

import type { CalendarViewEntry } from "@/definition/Calendar";

function entry(
  id: string,
  start: string,
  end: string,
  overrides: Partial<CalendarViewEntry> = {},
): CalendarViewEntry {
  return {
    id,
    seriesId: null,
    occurrenceStart: null,
    title: id,
    description: "",
    start,
    end,
    allDay: start.length === 10,
    calendar: { kind: "personal", projectId: null, name: "Meine Termine" },
    invitees: [],
    responses: [],
    myResponse: null,
    recurrence: null,
    source: { kind: "event", ticketKey: null },
    createdBy: { id: "me", name: "Igor" },
    editable: true,
    details: { eventId: id, link: null, createdByMe: true },
    ...overrides,
  };
}

describe("calendar dates", () => {
  it("computes ISO weeks, month grids and ranges", () => {
    expect(isoWeekNumber("2026-11-12")).toBe(46);
    expect(isoWeekNumber("2027-01-01")).toBe(53);
    const grid = monthGridDates("2026-11-12");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-10-26");
    expect(visibleRange("week", "2026-11-12")).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
    });
    expect(visibleRange("list", "2026-11-12")).toEqual({
      from: "2026-11-12",
      to: "2026-12-11",
    });
    expect(visibleRange("month", "2026-11-12").to).toBe("2026-12-06");
  });
});

describe("calendar dates", () => {
  it("moves anchors and checks dates", () => {
    expect(shiftAnchor("week", "2026-11-12", -1)).toBe("2026-11-05");
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-02-28")).toBe(true);
  });
});

describe("calendar layout", () => {
  it("places overlapping entries side by side", () => {
    const entries = [
      entry("a", "2026-11-12T09:00:00+01:00", "2026-11-12T11:00:00+01:00"),
      entry("b", "2026-11-12T10:00:00+01:00", "2026-11-12T12:00:00+01:00"),
      entry("c", "2026-11-12T11:00:00+01:00", "2026-11-12T11:30:00+01:00"),
      entry("d", "2026-11-12T14:00:00+01:00", "2026-11-12T15:00:00+01:00"),
      entry("all", "2026-11-12", "2026-11-12"),
    ];
    const placed = layoutDay(entries, "2026-11-12");
    const byId = new Map(placed.map((block) => [block.entry.id, block]));
    expect(placed).toHaveLength(4);
    expect(byId.get("a")).toMatchObject({
      column: 0,
      columns: 2,
      startMinute: 540,
    });
    expect(byId.get("b")).toMatchObject({ column: 1, columns: 2 });
    expect(byId.get("c")).toMatchObject({ column: 0, columns: 2 });
    expect(byId.get("d")).toMatchObject({
      column: 0,
      columns: 1,
      endMinute: 900,
    });
  });
});

describe("calendar layout", () => {
  it("clips entries across midnight and orders a day", () => {
    const late = entry(
      "late",
      "2026-11-12T23:00:00+01:00",
      "2026-11-13T01:00:00+01:00",
    );
    const allDay = entry("trip", "2026-11-12", "2026-11-14");
    expect(layoutDay([late], "2026-11-13")[0]).toMatchObject({
      startMinute: 0,
      endMinute: 60,
    });
    expect(
      entriesOfDay([late, allDay], "2026-11-13").map((item) => item.id),
    ).toEqual(["trip", "late"]);
    expect(firstScrollMinute([], ["2026-11-12"])).toBe(480);
    expect(firstScrollMinute([late], ["2026-11-12"])).toBe(1380);
  });
});

describe("calendar event draft", () => {
  it("builds fields with the offset of the account's zone", () => {
    const draft = {
      ...draftForNew({ date: "2026-11-12", minute: 14 * 60 }),
      title: " Release-Planung ",
      repeat: {
        ...repeatFieldsOf(null, "2026-11-12"),
        preset: "weekly" as const,
        end: "until" as const,
        until: "2027-03-31",
      },
    };
    const result = fieldsOfDraft(draft, "Europe/Berlin");
    expect(result).toEqual({
      ok: true,
      fields: {
        title: "Release-Planung",
        description: "",
        start: "2026-11-12T14:00:00+01:00",
        end: "2026-11-12T15:00:00+01:00",
        allDay: false,
        calendarProjectId: null,
        invitees: [],
        recurrence: {
          frequency: "weekly",
          interval: 1,
          weekdays: ["th"],
          until: "2027-03-31",
          count: null,
        },
      },
    });
  });
});

describe("calendar event draft", () => {
  it("rejects missing titles and ends before the start", () => {
    const draft = draftForNew({ date: "2026-11-12", minute: null });
    expect(fieldsOfDraft(draft, "UTC")).toEqual({
      ok: false,
      problem: "title",
    });
    expect(
      fieldsOfDraft(
        { ...draft, title: "x", allDay: true, endDate: "2026-11-11" },
        "UTC",
      ),
    ).toEqual({ ok: false, problem: "endBeforeStart" });
    const overnight = fieldsOfDraft(
      { ...draft, title: "x", startTime: "23:00", endTime: "01:00" },
      "UTC",
    );
    expect(overnight.ok && overnight.fields.end).toBe(
      "2026-11-13T01:00:00+00:00",
    );
  });
});

describe("calendar event draft", () => {
  it("sends only changed fields and no rule for one occurrence", () => {
    const series = entry(
      "s~1",
      "2026-11-12T14:00:00+01:00",
      "2026-11-12T16:00:00+01:00",
      {
        seriesId: "s",
        recurrence: {
          frequency: "weekly",
          interval: 1,
          weekdays: ["th"],
          until: null,
          count: null,
        },
      },
    );
    const initial = draftFromEntry(series);
    expect(initial.repeat.preset).toBe("weekly");
    const draft = {
      ...initial,
      title: "Neu",
      repeat: { ...initial.repeat, preset: "daily" as const },
    };
    const result = fieldsOfDraft(draft, "Europe/Berlin");
    if (!result.ok) throw new Error("expected fields");
    expect(patchOfDraft(result.fields, draft, initial, "this")).toEqual({
      title: "Neu",
    });
    expect(patchOfDraft(result.fields, draft, initial, "all")).toEqual({
      title: "Neu",
      recurrence: {
        frequency: "daily",
        interval: 1,
        weekdays: [],
        until: null,
        count: null,
      },
    });
  });
});

describe("calendar event draft", () => {
  it("maps workdays and custom rules", () => {
    const workdays = repeatFieldsOf(
      {
        frequency: "weekly",
        interval: 1,
        weekdays: ["mo", "tu", "we", "th", "fr"],
        until: null,
        count: 5,
      },
      "2026-11-12",
    );
    expect(workdays).toMatchObject({
      preset: "weekdays",
      end: "count",
      count: 5,
    });
    const custom = repeatFieldsOf(
      {
        frequency: "weekly",
        interval: 2,
        weekdays: ["we", "mo"],
        until: null,
        count: null,
      },
      "2026-11-12",
    );
    expect(custom.preset).toBe("custom");
    expect(recurrenceOf(custom, "2026-11-12")).toEqual({
      frequency: "weekly",
      interval: 2,
      weekdays: ["mo", "we"],
      until: null,
      count: null,
    });
  });
});
