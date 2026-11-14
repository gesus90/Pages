import { vi } from "vitest";

import { McpCalendarContext } from "@/backend/service/mcp/calendar/McpCalendarContext";

import type { McpCalendarService } from "@/backend/service/mcp/calendar/McpCalendarContext";
import type {
  CalendarEventView,
  CalendarViewEntry,
} from "@/definition/Calendar";
import type { User } from "@/definition/User";

/** A UUID operation ID for requests. */
export const OPERATION_ID = "0b5c3a0e-8a3f-4c2b-9d7e-2f1a6b4c8d90";

/** The paired account of the tests. */
export const ADA: User = {
  id: "ada",
  username: "ada",
  displayName: "Ada",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

/** A list entry of a personal event. */
export function viewEntry(
  overrides: Partial<CalendarViewEntry> = {},
): CalendarViewEntry {
  return {
    id: "event-1",
    seriesId: null,
    occurrenceStart: null,
    title: "Standup",
    description: "secret details",
    start: "2026-11-16T09:00:00+01:00",
    end: "2026-11-16T09:15:00+01:00",
    allDay: false,
    calendar: { kind: "personal", projectId: null, name: "Meine Termine" },
    invitees: [{ kind: "person", id: "bob", name: "Bob" }],
    responses: [{ userId: "bob", name: "Bob", response: "open" }],
    myResponse: null,
    recurrence: null,
    source: { kind: "event", ticketKey: null },
    createdBy: { id: "ada", name: "Ada" },
    editable: true,
    details: { eventId: "event-1", link: null, createdByMe: true },
    ...overrides,
  };
}

/** The detail read of a stored event. */
export function eventView(
  overrides: Partial<CalendarEventView> = {},
): CalendarEventView {
  return {
    id: "event-1",
    title: "Standup",
    description: "Daily",
    start: "2026-11-16T09:00:00+01:00",
    end: "2026-11-16T09:15:00+01:00",
    allDay: false,
    timeZone: "Europe/Berlin",
    calendar: { kind: "personal", projectId: null, name: "Meine Termine" },
    recurrence: null,
    invitees: [],
    responses: [],
    myResponse: null,
    createdBy: { id: "ada", name: "Ada" },
    exceptions: [],
    permissions: { canEdit: true, canDelete: true, canRespond: false },
    revision: 3,
    ...overrides,
  };
}

/** A calendar service whose every method is a mock; `runOnce` runs the work fresh. */
export function mockCalendar(): {
  [Name in keyof McpCalendarService]: ReturnType<typeof vi.fn>;
} {
  const runOnce = vi.fn();
  runOnce.mockImplementation(
    async (actor: User, operation: unknown, work: () => Promise<unknown>) => (
      void actor,
      void operation,
      {
        kind: "fresh",
        result: await work(),
      }
    ),
  );
  return {
    readRange: vi.fn(),
    readEvent: vi.fn().mockResolvedValue(eventView()),
    create: vi.fn().mockResolvedValue(viewEntry()),
    update: vi.fn().mockResolvedValue(viewEntry()),
    respond: vi.fn().mockResolvedValue(viewEntry()),
    delete: vi.fn().mockResolvedValue({ eventId: "event-1" }),
    previewDelete: vi.fn(),
    searchInvitees: vi.fn().mockResolvedValue([]),
    options: vi.fn(),
    runOnce,
  };
}

/** Opens a request context over the mocked calendar. */
export function contextOf(
  calendar: ReturnType<typeof mockCalendar>,
  isReadOnly = false,
): McpCalendarContext {
  return new McpCalendarContext({
    actor: ADA,
    isReadOnly,
    calendar: calendar as unknown as McpCalendarService,
  });
}
