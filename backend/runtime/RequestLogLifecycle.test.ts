import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DatabaseLogMetrics } from "@/backend/logging/DatabaseLogMetrics";
import { logEvent } from "@/backend/logging/Logger";
import { RouteLogMetrics } from "@/backend/logging/RouteLogMetrics";

import { RequestLogLifecycle } from "./RequestLogLifecycle";

import type { RequestLogDetails } from "./RequestLogLifecycle";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

let clockMs = 0;
let confirmAuthorization = vi.fn();

function createResponse(): ServerResponse {
  return new ServerResponse(new IncomingMessage(new Socket()));
}

function observe(overrides: Partial<RequestLogDetails> = {}): {
  response: ServerResponse;
  lifecycle: RequestLogLifecycle;
} {
  const lifecycle = new RequestLogLifecycle(
    {
      requestId: "request-1",
      method: "GET",
      route: "/wiki/:id",
      isPolling: false,
      ...overrides,
    },
    { database: new DatabaseLogMetrics(), routes: new RouteLogMetrics() },
    confirmAuthorization,
  );
  const response = createResponse();
  lifecycle.observe(response);

  return { response, lifecycle };
}

function finishWith(
  response: ServerResponse,
  statusCode: number,
  durationMs: number,
): void {
  response.statusCode = statusCode;
  clockMs += durationMs;
  response.emit("finish");
}

function loggedEvents(): string[] {
  return vi.mocked(logEvent).mock.calls.map(([event]) => event.event);
}

function lastLevel(): string | undefined {
  return vi.mocked(logEvent).mock.lastCall?.[0].level;
}

beforeEach(() => {
  clockMs = 1_000;
  confirmAuthorization = vi.fn();
  vi.spyOn(performance, "now").mockImplementation(() => clockMs);
  vi.stubEnv("PAGES_SLOW_QUERY_MS", "250");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it("sets the request id header and logs the start of an ordinary request", () => {
  const { response } = observe();

  expect(response.getHeader("X-Request-ID")).toBe("request-1");
  expect(logEvent).toHaveBeenCalledTimes(1);
  expect(logEvent).toHaveBeenCalledWith({
    level: "info",
    event: "http.request.started",
    component: "PagesServer",
    message: "HTTP request started",
    metadata: { requestId: "request-1", method: "GET", route: "/wiki/:id" },
  });
});

it("does not log the start of a polling request but still sets the header", () => {
  const { response } = observe({ isPolling: true });

  expect(response.getHeader("X-Request-ID")).toBe("request-1");
  expect(logEvent).not.toHaveBeenCalled();
});

it("logs the completion summary with duration, counters and status at info level", () => {
  const { response } = observe();
  vi.mocked(logEvent).mockClear();

  finishWith(response, 200, 40);

  expect(logEvent).toHaveBeenCalledTimes(1);
  expect(vi.mocked(logEvent).mock.lastCall?.[0]).toMatchObject({
    level: "info",
    event: "http.request.completed",
    component: "PagesServer",
    message: "HTTP request completed",
    metadata: {
      requestId: "request-1",
      method: "GET",
      route: "/wiki/:id",
      durationMs: 40,
      statusCode: 200,
      databaseQueries: 0,
      routeLoaders: 0,
    },
  });
  expect(confirmAuthorization).toHaveBeenCalledTimes(1);
});

it("confirms authorization up to the last redirect status and not for 400", () => {
  const redirect = observe();
  finishWith(redirect.response, 399, 1);
  const clientError = observe();
  finishWith(clientError.response, 400, 1);

  expect(confirmAuthorization).toHaveBeenCalledTimes(1);
});

it("does not treat informational statuses below 200 as successful", () => {
  const { response } = observe();
  finishWith(response, 199, 1);

  expect(confirmAuthorization).not.toHaveBeenCalled();
  expect(lastLevel()).toBe("info");
});

it("logs server errors at error level without confirming authorization", () => {
  const { response } = observe();
  finishWith(response, 500, 1);

  expect(lastLevel()).toBe("error");
  expect(confirmAuthorization).not.toHaveBeenCalled();
});

it("logs client errors of an ordinary request at info level", () => {
  const { response } = observe();
  finishWith(response, 404, 1);

  expect(lastLevel()).toBe("info");
  expect(loggedEvents()).toEqual([
    "http.request.started",
    "http.request.completed",
  ]);
});

it.each([401, 403])(
  "adds an access denied warning for status %i",
  (statusCode) => {
    const { response } = observe();
    finishWith(response, statusCode, 1);

    expect(loggedEvents()).toEqual([
      "http.request.started",
      "http.request.completed",
      "authorization.http.denied",
    ]);
    expect(vi.mocked(logEvent).mock.lastCall?.[0]).toEqual({
      level: "warn",
      event: "authorization.http.denied",
      component: "PagesServer",
      message: "HTTP access denied",
      metadata: {
        requestId: "request-1",
        method: "GET",
        route: "/wiki/:id",
        statusCode,
      },
    });
  },
);

it("keeps a fast successful poll silent but still confirms authorization", () => {
  const { response } = observe({ isPolling: true });
  finishWith(response, 200, 249);

  expect(logEvent).not.toHaveBeenCalled();
  expect(confirmAuthorization).toHaveBeenCalledTimes(1);
});

it("warns about a successful poll that reaches the slow threshold", () => {
  const { response } = observe({ isPolling: true });
  finishWith(response, 200, 250);

  expect(loggedEvents()).toEqual(["http.request.completed"]);
  expect(lastLevel()).toBe("warn");
});

it("honours a configured slow threshold", () => {
  vi.stubEnv("PAGES_SLOW_QUERY_MS", "1000");
  const { response } = observe({ isPolling: true });
  finishWith(response, 200, 500);

  expect(logEvent).not.toHaveBeenCalled();
});

it("warns about a failing poll with a client error", () => {
  const { response } = observe({ isPolling: true });
  finishWith(response, 400, 1);

  expect(lastLevel()).toBe("warn");
  expect(confirmAuthorization).not.toHaveBeenCalled();
});

it("logs a failing poll with a server error at error level", () => {
  const { response } = observe({ isPolling: true });
  finishWith(response, 503, 1);

  expect(lastLevel()).toBe("error");
});

it("logs the denial of a polling request after its completion", () => {
  const { response } = observe({ isPolling: true });
  finishWith(response, 401, 1);

  expect(loggedEvents()).toEqual([
    "http.request.completed",
    "authorization.http.denied",
  ]);
});

it("logs an abort when the connection closes before the response finished", () => {
  const { response } = observe();
  vi.mocked(logEvent).mockClear();
  clockMs += 75;

  response.emit("close");

  expect(logEvent).toHaveBeenCalledTimes(1);
  expect(vi.mocked(logEvent).mock.lastCall?.[0]).toMatchObject({
    level: "warn",
    event: "http.request.aborted",
    component: "PagesServer",
    message: "HTTP connection closed before response completion",
    metadata: {
      requestId: "request-1",
      durationMs: 75,
      routeLoaders: 0,
    },
  });
  expect(confirmAuthorization).not.toHaveBeenCalled();
});

it("does not log an abort after the response finished", () => {
  const { response } = observe();
  finishWith(response, 200, 1);
  vi.mocked(logEvent).mockClear();

  response.emit("close");

  expect(logEvent).not.toHaveBeenCalled();
});

it("logs an abort only once", () => {
  const { response } = observe();
  vi.mocked(logEvent).mockClear();

  response.emit("close");
  response.emit("close");

  expect(logEvent).toHaveBeenCalledTimes(1);
});
