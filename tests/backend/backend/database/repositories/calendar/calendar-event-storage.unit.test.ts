import { describe, expect, it, vi } from "vitest";

import { CalendarEventRepository } from "@/backend/database/repositories/calendar/CalendarEventRepository";

const row = [
  "e",
  "Title",
  "Description",
  0,
  "start",
  "end",
  "UTC",
  null,
  "u",
  2,
  null,
  null,
  null,
  null,
  null,
  null,
];

describe("calendar event storage", () => {
  it("reads standalone events, recurrence and exceptions", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([
        [...row.slice(0, 11), "weekly", 2, '["mo","bad","fr"]', null, 4],
      ])
      .mockResolvedValueOnce([["e", "start", 1, null, null, null, null, null]]);
    const repository = new CalendarEventRepository({ query, execute: vi.fn() });
    await expect(repository.findById("missing")).resolves.toBeNull();
    await expect(repository.findById("e")).resolves.toMatchObject({
      id: "e",
      recurrence: null,
    });
    await expect(
      repository.findVisible(
        { userId: "u", groupIds: [], departmentIds: [], projectIds: ["p"] },
        { fromDate: "2026-01-01", toDate: "2026-01-31" },
      ),
    ).resolves.toMatchObject([
      {
        recurrence: {
          frequency: "weekly",
          interval: 2,
          weekdays: ["mo", "fr"],
          count: 4,
        },
      },
    ]);
    await expect(repository.findExceptions(["e"])).resolves.toMatchObject([
      { eventId: "e", isCancelled: true, allDay: null },
    ]);
  });

  it("rejects invalid recurrence frequency and ignores non-array weekdays", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        [...row.slice(0, 11), "bad", 1, "[]", null, null],
      ])
      .mockResolvedValueOnce([
        [...row.slice(0, 11), "daily", 1, "{}", null, null],
      ]);
    const repository = new CalendarEventRepository({ query, execute: vi.fn() });
    await expect(repository.findById("e")).rejects.toThrow("frequency");
    await expect(repository.findById("e")).resolves.toMatchObject({
      recurrence: { frequency: "daily", weekdays: [], count: null },
    });
  });

  it("writes event rules and bounded exception changes", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const repository = new CalendarEventRepository({ query: vi.fn(), execute });
    const event = {
      id: "e",
      title: "Title",
      description: "",
      allDay: false,
      startAt: "start",
      endAt: "end",
      timeZone: "UTC",
      projectId: null,
      createdBy: "u",
      recurrence: null,
    };
    await repository.insert(event);
    await repository.update({
      ...event,
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["mo"],
        until: null,
        count: 2,
      },
    });
    await repository.deleteExceptions("e");
    await repository.deleteExceptions("e", {
      fromOccurrence: "date",
      onlyChanged: true,
    });
    expect(execute).toHaveBeenCalledTimes(7);
  });
});
