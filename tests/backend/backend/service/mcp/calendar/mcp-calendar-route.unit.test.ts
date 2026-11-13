import { beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarError } from "@/backend/error/CalendarError";
import { McpDeviceError } from "@/backend/error/McpDeviceError";
import * as deleteRoute from "@/app/routes/api-mcp-v1-calendar-event-delete";
import * as eventRoute from "@/app/routes/api-mcp-v1-calendar-event";
import * as entriesRoute from "@/app/routes/api-mcp-v1-calendar-entries";
import * as eventsRoute from "@/app/routes/api-mcp-v1-calendar-events";
import * as inviteesRoute from "@/app/routes/api-mcp-v1-calendar-invitees";
import * as optionsRoute from "@/app/routes/api-mcp-v1-calendar-options";
import * as responseRoute from "@/app/routes/api-mcp-v1-calendar-event-response";

import {
  ADA,
  OPERATION_ID,
  eventView,
  mockCalendar,
  viewEntry,
} from "./mcp-calendar-fixtures";

const services = vi.hoisted(() => ({
  calendarService: {},
  mcpDeviceService: { authenticate: vi.fn() },
  userService: { findCredentialsByUsername: vi.fn() },
  mcpAgentEmployees: { find: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const BASE = "http://pages.invalid/api/mcp/v1/calendar";

let calendar = mockCalendar();

beforeEach(() => {
  calendar = mockCalendar();
  services.calendarService = calendar;
  services.mcpDeviceService.authenticate.mockResolvedValue({
    account: { username: "ada", displayName: "Ada" },
  });
  services.userService.findCredentialsByUsername.mockResolvedValue({
    user: ADA,
  });
  services.mcpAgentEmployees.find.mockResolvedValue(null);
});

interface RouteArguments {
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
}

type RouteHandler = (args: never) => Promise<Response>;

async function call(
  handler: RouteHandler,
  request: Request,
  params: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const args: RouteArguments = { request, params };
  return (handler as (input: RouteArguments) => Promise<Response>)(args);
}

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string): Request {
  return new Request(`${BASE}${path}`, {
    headers: { Authorization: "Bearer token" },
  });
}

describe("calendar routes", () => {
  it("serves options, invitees and entries as reads", async () => {
    calendar.options.mockResolvedValue({ timeZone: "UTC" });
    const options = await call(optionsRoute.loader, getRequest("/options"));
    expect(options.status).toBe(200);
    expect(options.headers.get("Cache-Control")).toBe("no-store");
    expect(await options.json()).toEqual({ timeZone: "UTC" });

    const invitees = await call(
      inviteesRoute.loader,
      getRequest("/invitees?text=bo&limit=5"),
    );
    expect(await invitees.json()).toEqual({ invitees: [] });
    expect(calendar.searchInvitees).toHaveBeenCalledWith(ADA, "bo", 5);

    calendar.readRange.mockResolvedValue({
      from: "2026-11-16",
      to: "2026-11-22",
      timeZone: "UTC",
      entries: [viewEntry()],
    });
    const entries = await call(
      entriesRoute.loader,
      getRequest("/entries?from=2026-11-16&to=2026-11-22&kinds=personal"),
    );
    const body: unknown = await entries.json();
    expect(body).toMatchObject({
      timeZone: "UTC",
      entries: [{ id: "event-1" }],
    });
  });

  it("answers an unserved method with 405 and a bad query with 400", async () => {
    const wrong = await call(
      optionsRoute.action,
      new Request(`${BASE}/options`, { method: "POST" }),
    );
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Allow")).toBe("GET");
    const bad = await call(
      entriesRoute.loader,
      getRequest("/entries?from=2026-11-16&to=2026-11-22&kinds=holiday"),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_request" });
  });

  it("refuses a request without a valid token with 401", async () => {
    services.mcpDeviceService.authenticate.mockRejectedValue(
      new McpDeviceError("invalid_token", 401),
    );
    const response = await call(optionsRoute.loader, getRequest("/options"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
  });
});

describe("calendar routes for changes", () => {
  it("creates with 201 and repeats the same body with 200", async () => {
    const body = {
      operationId: OPERATION_ID,
      title: "Review",
      start: "2026-11-16T10:00:00+01:00",
      end: "2026-11-16T11:00:00+01:00",
      allDay: false,
    };
    const created = await call(
      eventsRoute.action,
      jsonRequest("/events", "POST", body),
    );
    expect(created.status).toBe(201);
    const first: unknown = await created.json();
    expect(first).toMatchObject({
      timeZone: "Europe/Berlin",
      event: { id: "event-1" },
    });
    calendar.runOnce.mockResolvedValue({ kind: "replayed", result: first });
    const repeated = await call(
      eventsRoute.action,
      jsonRequest("/events", "POST", body),
    );
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(first);
  });

  it("forbids a read-only agent to change anything", async () => {
    services.userService.findCredentialsByUsername.mockResolvedValue({
      user: { ...ADA, isAgent: true },
    });
    services.mcpAgentEmployees.find.mockResolvedValue({ access: "read_only" });
    const response = await call(
      responseRoute.action,
      jsonRequest("/events/event-1/response", "POST", {
        operationId: OPERATION_ID,
        response: "accepted",
      }),
      { eventId: "event-1" },
    );
    expect(response.status).toBe(403);
    expect(calendar.respond).not.toHaveBeenCalled();
    const read = await call(eventRoute.loader, getRequest("/events/event-1"), {
      eventId: "event-1",
    });
    expect(read.status).toBe(200);
  });

  it("answers a stale revision with 409 and the current revision only", async () => {
    calendar.update.mockRejectedValue(
      new CalendarError("conflict", "Secret meeting changed", 8),
    );
    const response = await call(
      eventRoute.action,
      jsonRequest("/events/event-1", "PATCH", {
        operationId: OPERATION_ID,
        expectedRevision: 3,
        title: "Neu",
      }),
      { eventId: "event-1" },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "conflict",
      currentRevision: 8,
    });
  });
});

describe("calendar routes for failures and deletion", () => {
  it("answers an unknown event with 404 without naming it", async () => {
    calendar.readEvent.mockRejectedValue(
      new CalendarError("not_found", "Event 'Secret' is hidden"),
    );
    const response = await call(
      eventRoute.loader,
      getRequest("/events/milestone:1"),
      { eventId: "milestone:1" },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("asks before deleting and deletes with the confirmation", async () => {
    const preview = {
      confirmationRequired: true,
      event: { id: "event-1", title: "Standup", start: "2026-11-16" },
      scope: "all",
      affectedOccurrences: 1,
      invitedCount: 0,
    };
    calendar.previewDelete.mockResolvedValue(preview);
    calendar.readEvent.mockResolvedValue(eventView());
    const question = await call(
      deleteRoute.action,
      jsonRequest("/events/event-1/delete", "POST", {
        operationId: OPERATION_ID,
        expectedRevision: 3,
      }),
      { eventId: "event-1" },
    );
    expect(await question.json()).toEqual(preview);
    expect(calendar.delete).not.toHaveBeenCalled();
    const deleted = await call(
      deleteRoute.action,
      jsonRequest("/events/event-1/delete", "POST", {
        operationId: OPERATION_ID,
        expectedRevision: 3,
        confirmed: true,
      }),
      { eventId: "event-1" },
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      deleted: true,
      eventId: "event-1",
      scope: "all",
    });
  });

  it("refuses an oversized body with 413 and another content type with 400", async () => {
    const large = await call(
      eventsRoute.action,
      jsonRequest("/events", "POST", { title: "x".repeat(300_000) }),
    );
    expect(large.status).toBe(413);
    expect(await large.json()).toEqual({ error: "too_large" });
    const text = await call(
      eventsRoute.action,
      new Request(`${BASE}/events`, {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "text/plain",
        },
        body: "{}",
      }),
    );
    expect(text.status).toBe(400);
  });
});
