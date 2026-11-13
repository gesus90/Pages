import { describe, expect, it } from "vitest";

import { CalendarError } from "@/backend/error/CalendarError";
import { McpCalendarError } from "@/backend/service/mcp/calendar/McpCalendarError";
import { McpCalendarLifecycleService } from "@/backend/service/mcp/calendar/McpCalendarLifecycleService";
import { McpCalendarReadService } from "@/backend/service/mcp/calendar/McpCalendarReadService";
import { McpCalendarWriteService } from "@/backend/service/mcp/calendar/McpCalendarWriteService";

import {
  ADA,
  OPERATION_ID,
  contextOf,
  eventView,
  mockCalendar,
  viewEntry,
} from "./mcp-calendar-fixtures";

const RULE = {
  frequency: "weekly",
  interval: 1,
  weekdays: ["mo"],
  until: null,
  count: null,
} as const;

const FIELDS = {
  title: "Review",
  description: "",
  start: "2026-11-16T10:00:00+01:00",
  end: "2026-11-16T11:00:00+01:00",
  allDay: false,
  calendarProjectId: null,
  invitees: [],
  recurrence: null,
};

const reads = new McpCalendarReadService();
const writes = new McpCalendarWriteService();
const lifecycle = new McpCalendarLifecycleService();

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error === null) return null;
  return error instanceof McpCalendarError ? error.code : "other";
}

describe("calendar reads", () => {
  it("lists entries in the contract shape with the time zone and without details", async () => {
    const calendar = mockCalendar();
    calendar.readRange.mockResolvedValue({
      from: "2026-11-16",
      to: "2026-11-22",
      timeZone: "Europe/Berlin",
      entries: [
        viewEntry(),
        viewEntry({
          id: "due:T-1",
          title: "T-1 fällig",
          calendar: { kind: "due", projectId: "p1", name: "Alpha" },
          source: { kind: "ticket", ticketKey: "T-1" },
          editable: false,
          details: { eventId: null, link: "/t/T-1", createdByMe: false },
        }),
      ],
    });
    const answer = await reads.list(contextOf(calendar), {
      from: "2026-11-16",
      to: "2026-11-22",
      kinds: ["personal", "due"],
    });
    expect(calendar.readRange).toHaveBeenCalledWith(
      ADA,
      { from: "2026-11-16", to: "2026-11-22" },
      { kinds: ["personal", "due"] },
    );
    expect(answer.timeZone).toBe("Europe/Berlin");
    expect(answer.entries[0]).toEqual({
      id: "event-1",
      eventId: "event-1",
      occurrenceStart: null,
      title: "Standup",
      start: "2026-11-16T09:00:00+01:00",
      end: "2026-11-16T09:15:00+01:00",
      allDay: false,
      calendar: { kind: "personal", projectId: null, name: "Meine Termine" },
      source: { kind: "event", ticketKey: null },
      myResponse: null,
      editable: true,
    });
    expect(answer.entries[1]).toMatchObject({
      eventId: null,
      editable: false,
      source: { kind: "ticket", ticketKey: "T-1" },
    });
  });

  it("answers too_large above 2,000 entries and marks nothing editable for a read-only agent", async () => {
    const calendar = mockCalendar();
    const range = { from: "2026-11-01", to: "2026-11-30" };
    calendar.readRange.mockResolvedValueOnce({
      ...range,
      timeZone: "UTC",
      entries: Array.from({ length: 2001 }, () => viewEntry()),
    });
    expect(await codeOf(reads.list(contextOf(calendar), range))).toBe(
      "too_large",
    );
    calendar.readRange.mockResolvedValueOnce({
      ...range,
      timeZone: "UTC",
      entries: [viewEntry()],
    });
    const answer = await reads.list(contextOf(calendar, true), range);
    expect(calendar.readRange).toHaveBeenLastCalledWith(ADA, range, {});
    expect(answer.entries[0]?.editable).toBe(false);
  });
});

describe("calendar event reads", () => {
  it("reads an event with every detail and no rights for a read-only agent", async () => {
    const calendar = mockCalendar();
    const answer = await reads.read(contextOf(calendar), "event-1");
    expect(answer.timeZone).toBe("Europe/Berlin");
    expect(answer.event).toMatchObject({
      id: "event-1",
      eventId: "event-1",
      occurrenceStart: null,
      description: "Daily",
      source: { kind: "event", ticketKey: null },
      editable: true,
      revision: 3,
      exceptions: [],
      createdBy: { id: "ada", name: "Ada" },
    });
    const readOnly = await reads.read(contextOf(calendar, true), "event-1");
    expect(readOnly.event.permissions).toEqual({
      canEdit: false,
      canDelete: false,
      canRespond: false,
    });
    expect(readOnly.event.editable).toBe(false);
  });

  it("passes options through and projects invitee options", async () => {
    const calendar = mockCalendar();
    calendar.options.mockResolvedValue({ timeZone: "UTC" });
    expect(await reads.options(contextOf(calendar))).toEqual({
      timeZone: "UTC",
    });
    calendar.searchInvitees.mockResolvedValue([
      { kind: "group", id: "g1", name: "Team" },
    ]);
    expect(
      await reads.invitees(contextOf(calendar), { text: "te", limit: 50 }),
    ).toEqual({ invitees: [{ kind: "group", id: "g1", name: "Team" }] });
    expect(calendar.searchInvitees).toHaveBeenCalledWith(ADA, "te", 50);
  });
});

describe("calendar changes", () => {
  it("creates once per operation ID and answers the stored event", async () => {
    const calendar = mockCalendar();
    calendar.create.mockResolvedValue(
      viewEntry({
        id: "event-9:2026-11-16",
        details: { eventId: "event-9", link: null, createdByMe: true },
      }),
    );
    calendar.readEvent.mockResolvedValue(eventView({ id: "event-9" }));
    const outcome = await writes.create(contextOf(calendar), {
      operationId: OPERATION_ID,
      fields: FIELDS,
    });
    expect(calendar.runOnce).toHaveBeenCalledWith(
      ADA,
      {
        operationId: OPERATION_ID,
        request: { operation: "create_calendar_event", ...FIELDS },
      },
      expect.any(Function),
    );
    expect(calendar.create).toHaveBeenCalledWith(ADA, FIELDS);
    expect(calendar.readEvent).toHaveBeenCalledWith(ADA, "event-9");
    expect(outcome.kind).toBe("fresh");
    expect(outcome.kind === "fresh" ? outcome.result.event.id : null).toBe(
      "event-9",
    );
  });

  it("passes a stored answer through without running the work again", async () => {
    const calendar = mockCalendar();
    calendar.runOnce.mockResolvedValue({
      kind: "replayed",
      result: { stored: true },
    });
    const outcome = await writes.create(contextOf(calendar), {
      operationId: OPERATION_ID,
      fields: FIELDS,
    });
    expect(outcome).toEqual({ kind: "replayed", result: { stored: true } });
    expect(calendar.create).not.toHaveBeenCalled();
  });

  it("refuses every change of a read-only agent before the journal", async () => {
    const calendar = mockCalendar();
    const context = contextOf(calendar, true);
    const target = { expectedRevision: 1 };
    expect(
      await codeOf(
        writes.create(context, { operationId: OPERATION_ID, fields: FIELDS }),
      ),
    ).toBe("forbidden");
    expect(
      await codeOf(
        writes.update(context, "event-1", {
          operationId: OPERATION_ID,
          target,
          patch: { title: "x" },
        }),
      ),
    ).toBe("forbidden");
    expect(
      await codeOf(
        writes.respond(context, "event-1", {
          operationId: OPERATION_ID,
          response: "accepted",
        }),
      ),
    ).toBe("forbidden");
    expect(calendar.runOnce).not.toHaveBeenCalled();
  });
});

describe("calendar changes of existing events", () => {
  it("changes a single event as a whole when no scope is named", async () => {
    const calendar = mockCalendar();
    const outcome = await writes.update(contextOf(calendar), "event-1", {
      operationId: OPERATION_ID,
      target: { expectedRevision: 3 },
      patch: { title: "Neu" },
    });
    expect(calendar.update).toHaveBeenCalledWith(
      ADA,
      {
        id: "event-1",
        expectedRevision: 3,
        occurrenceStart: null,
        scope: "all",
      },
      { title: "Neu" },
    );
    expect(outcome.kind).toBe("fresh");
  });

  it("requires a scope for a series and passes a named scope on", async () => {
    const calendar = mockCalendar();
    calendar.readEvent.mockResolvedValue(eventView({ recurrence: RULE }));
    const request = {
      operationId: OPERATION_ID,
      target: { expectedRevision: 3 },
      patch: { title: "Neu" },
    };
    expect(
      await codeOf(writes.update(contextOf(calendar), "event-1", request)),
    ).toBe("invalid_request");
    expect(calendar.update).not.toHaveBeenCalled();
    await writes.update(contextOf(calendar), "event-1", {
      ...request,
      target: {
        expectedRevision: 3,
        scope: "this",
        occurrenceStart: "2026-11-23",
      },
    });
    expect(calendar.update).toHaveBeenCalledWith(
      ADA,
      {
        id: "event-1",
        expectedRevision: 3,
        occurrenceStart: "2026-11-23",
        scope: "this",
      },
      { title: "Neu" },
    );
  });

  it("lets a stale revision surface as a conflict with the current revision", async () => {
    const calendar = mockCalendar();
    calendar.update.mockRejectedValue(
      new CalendarError("conflict", "changed", 5),
    );
    const failure = await writes
      .update(contextOf(calendar), "event-1", {
        operationId: OPERATION_ID,
        target: { expectedRevision: 3, scope: "all" },
        patch: { title: "Neu" },
      })
      .catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(CalendarError);
    expect(
      failure instanceof CalendarError ? failure.currentRevision : null,
    ).toBe(5);
  });
});

describe("calendar answers to invitations", () => {
  it("answers an invitation and returns the stored event", async () => {
    const calendar = mockCalendar();
    calendar.respond.mockResolvedValue(
      viewEntry({ details: { eventId: null, link: null, createdByMe: false } }),
    );
    const outcome = await writes.respond(contextOf(calendar), "event-1", {
      operationId: OPERATION_ID,
      response: "accepted",
    });
    expect(calendar.respond).toHaveBeenCalledWith(ADA, "event-1", "accepted");
    expect(calendar.readEvent).toHaveBeenCalledWith(ADA, "event-1");
    expect(calendar.runOnce.mock.calls[0]?.[1]).toEqual({
      operationId: OPERATION_ID,
      request: {
        operation: "respond_calendar_event",
        eventId: "event-1",
        response: "accepted",
      },
    });
    expect(outcome.kind).toBe("fresh");
  });
});

describe("calendar deletion", () => {
  const preview = {
    confirmationRequired: true,
    event: {
      id: "event-1",
      title: "Standup",
      start: "2026-11-16T09:00:00+01:00",
    },
    scope: "all",
    affectedOccurrences: "unbegrenzt",
    invitedCount: 2,
  };

  it("asks first and changes nothing without the confirmation", async () => {
    const calendar = mockCalendar();
    calendar.previewDelete.mockResolvedValue(preview);
    const outcome = await lifecycle.delete(contextOf(calendar), "event-1", {
      operationId: OPERATION_ID,
      target: { expectedRevision: 3 },
      isConfirmed: false,
    });
    expect(outcome).toEqual({ kind: "fresh", result: preview });
    expect(calendar.delete).not.toHaveBeenCalled();
    expect(calendar.runOnce).not.toHaveBeenCalled();
  });

  it("deletes once with the confirmation and names event and scope", async () => {
    const calendar = mockCalendar();
    const outcome = await lifecycle.delete(contextOf(calendar), "event-1", {
      operationId: OPERATION_ID,
      target: { expectedRevision: 3, scope: "all" },
      isConfirmed: true,
    });
    expect(calendar.delete).toHaveBeenCalledWith(ADA, {
      id: "event-1",
      expectedRevision: 3,
      occurrenceStart: null,
      scope: "all",
    });
    expect(outcome).toEqual({
      kind: "fresh",
      result: { deleted: true, eventId: "event-1", scope: "all" },
    });
    expect(calendar.runOnce.mock.calls[0]?.[1]).toEqual({
      operationId: OPERATION_ID,
      request: {
        operation: "delete_calendar_event",
        eventId: "event-1",
        expectedRevision: 3,
        scope: "all",
      },
    });
  });

  it("refuses a read-only agent even the question", async () => {
    const calendar = mockCalendar();
    expect(
      await codeOf(
        lifecycle.delete(contextOf(calendar, true), "event-1", {
          operationId: OPERATION_ID,
          target: { expectedRevision: 3 },
          isConfirmed: false,
        }),
      ),
    ).toBe("forbidden");
    expect(calendar.previewDelete).not.toHaveBeenCalled();
  });
});
