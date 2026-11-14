import { describe, expect, it } from "vitest";

import { McpCalendarError } from "@/backend/service/mcp/calendar/McpCalendarError";
import { McpCalendarRequest } from "@/backend/service/mcp/calendar/McpCalendarRequest";

import { OPERATION_ID } from "./mcp-calendar-fixtures";

function codeOf(work: () => unknown): string | null {
  try {
    work();
  } catch (error: unknown) {
    return error instanceof McpCalendarError ? error.code : "other";
  }
  return null;
}

const EVENT = {
  operationId: OPERATION_ID,
  title: "Review",
  start: "2026-11-16T10:00:00+01:00",
  end: "2026-11-16T11:00:00+01:00",
  allDay: false,
};

describe("calendar API queries", () => {
  it("reads a range with a deduplicated comma-separated kinds filter", () => {
    const query = new URLSearchParams({
      from: "2026-11-01",
      to: "2026-11-30",
      kinds: "personal, due,personal",
    });
    expect(McpCalendarRequest.range(query)).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
      kinds: ["personal", "due"],
    });
    expect(
      McpCalendarRequest.range(
        new URLSearchParams({ from: "2026-11-01", to: "2026-11-02" }),
      ),
    ).toEqual({ from: "2026-11-01", to: "2026-11-02" });
  });

  it("refuses unknown kinds, unknown or repeated parameters and bad dates", () => {
    const base = "from=2026-11-01&to=2026-11-30";
    for (const text of [
      `${base}&kinds=personal,holiday`,
      `${base}&kinds=personal,`,
      `${base}&extra=1`,
      `${base}&from=2026-11-02`,
      "from=yesterday&to=2026-03-01",
      "from=2026-11-01",
    ])
      expect(
        codeOf(() => McpCalendarRequest.range(new URLSearchParams(text))),
      ).toBe("invalid_request");
  });

  it("reads the invitee search with a default limit and at most 50", () => {
    expect(McpCalendarRequest.invitees(new URLSearchParams())).toEqual({
      text: "",
      limit: 20,
    });
    expect(
      McpCalendarRequest.invitees(new URLSearchParams("text=bo&limit=50")),
    ).toEqual({ text: "bo", limit: 50 });
    for (const limit of ["51", "0", "abc", "-1"])
      expect(
        codeOf(() =>
          McpCalendarRequest.invitees(new URLSearchParams({ limit })),
        ),
      ).toBe("invalid_request");
  });

  it("refuses any query parameter where none is taken", () => {
    expect(() => McpCalendarRequest.empty(new URLSearchParams())).not.toThrow();
    expect(
      codeOf(() => McpCalendarRequest.empty(new URLSearchParams("a=1"))),
    ).toBe("invalid_request");
  });

  it("answers a missing or overlong event ID with not_found", () => {
    expect(McpCalendarRequest.eventId(" event-1 ")).toBe("event-1");
    expect(codeOf(() => McpCalendarRequest.eventId(undefined))).toBe(
      "not_found",
    );
    expect(codeOf(() => McpCalendarRequest.eventId("x".repeat(301)))).toBe(
      "not_found",
    );
  });
});

describe("calendar API bodies", () => {
  it("reads a new event with the defaults of the calendar", () => {
    expect(McpCalendarRequest.create(EVENT)).toEqual({
      operationId: OPERATION_ID,
      fields: {
        title: "Review",
        description: "",
        start: EVENT.start,
        end: EVENT.end,
        allDay: false,
        calendarProjectId: null,
        invitees: [],
        recurrence: null,
      },
    });
  });

  it("refuses a missing or non-UUID operation ID, unknown fields and a creator", () => {
    const withoutId: Partial<typeof EVENT> = { ...EVENT };
    delete withoutId.operationId;
    for (const body of [
      withoutId,
      { ...EVENT, operationId: "op-1" },
      { ...EVENT, createdBy: "bob" },
      { ...EVENT, title: "" },
    ])
      expect(codeOf(() => McpCalendarRequest.create(body))).toBe(
        "invalid_request",
      );
  });
});

describe("calendar API change and deletion bodies", () => {
  it("reads a change as target and named fields and needs at least one field", () => {
    expect(
      McpCalendarRequest.update({
        operationId: OPERATION_ID,
        expectedRevision: 2,
        scope: "following",
        occurrenceStart: "2026-11-23",
        title: "Neu",
        invitees: [],
      }),
    ).toEqual({
      operationId: OPERATION_ID,
      target: {
        expectedRevision: 2,
        scope: "following",
        occurrenceStart: "2026-11-23",
      },
      patch: { title: "Neu", invitees: [] },
    });
    expect(
      codeOf(() =>
        McpCalendarRequest.update({
          operationId: OPERATION_ID,
          expectedRevision: 2,
        }),
      ),
    ).toBe("invalid_request");
    expect(
      codeOf(() =>
        McpCalendarRequest.update({ operationId: OPERATION_ID, title: "x" }),
      ),
    ).toBe("invalid_request");
    expect(
      codeOf(() =>
        McpCalendarRequest.update({
          operationId: OPERATION_ID,
          expectedRevision: 2,
          scope: "some",
          title: "x",
        }),
      ),
    ).toBe("invalid_request");
  });

  it("reads an answer and a deletion", () => {
    expect(
      McpCalendarRequest.respond({
        operationId: OPERATION_ID,
        response: "declined",
      }),
    ).toEqual({ operationId: OPERATION_ID, response: "declined" });
    expect(
      codeOf(() =>
        McpCalendarRequest.respond({
          operationId: OPERATION_ID,
          response: "open",
        }),
      ),
    ).toBe("invalid_request");
    expect(
      McpCalendarRequest.delete({
        operationId: OPERATION_ID,
        expectedRevision: 1,
        confirmed: true,
      }),
    ).toEqual({
      operationId: OPERATION_ID,
      target: {
        expectedRevision: 1,
        scope: undefined,
        occurrenceStart: undefined,
      },
      isConfirmed: true,
    });
    expect(
      McpCalendarRequest.delete({
        operationId: OPERATION_ID,
        expectedRevision: 1,
      }).isConfirmed,
    ).toBe(false);
    expect(
      codeOf(() => McpCalendarRequest.delete({ operationId: OPERATION_ID })),
    ).toBe("invalid_request");
  });
});
