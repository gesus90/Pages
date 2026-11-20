import { randomUUID } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { beforeEach, expect, it, vi } from "vitest";

import { withDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import {
  logCaughtError,
  logEvent,
  withLogContext,
} from "@/backend/logging/Logger";

import { logRequest, safeRequestRoute } from "./RequestLogging";

import type * as NodeCrypto from "node:crypto";
import type { LogContext } from "@/backend/logging/Logger";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();

  return { ...actual, randomUUID: vi.fn() };
});
vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withDatabaseWork: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
  withLogContext: vi.fn(),
}));

const REQUEST_ID = "11111111-2222-4333-8444-555555555555";

interface RequestParts {
  readonly method?: string;
  readonly url?: string;
  readonly correlation?: string;
}

function createRequest(parts: RequestParts): IncomingMessage {
  const request = new IncomingMessage(new Socket());
  request.method = parts.method;
  request.url = parts.url;
  if (parts.correlation !== undefined)
    request.headers["x-correlation-id"] = parts.correlation;

  return request;
}

function createResponse(): ServerResponse {
  return new ServerResponse(new IncomingMessage(new Socket()));
}

function startedMetadata(): unknown {
  return vi
    .mocked(logEvent)
    .mock.calls.find(([event]) => event.event === "http.request.started")?.[0]
    .metadata;
}

function databaseWorkOptions(): { signal?: AbortSignal; origin?: string } {
  const options = vi.mocked(withDatabaseWork).mock.calls[0]?.[0];

  return { signal: options?.signal, origin: options?.origin };
}

let logContexts: LogContext[] = [];

beforeEach(() => {
  logContexts = [];
  vi.mocked(randomUUID).mockReturnValue(REQUEST_ID);
  vi.mocked(withLogContext).mockImplementation((context, work) => {
    logContexts.push(context);

    return work();
  });
  vi.mocked(withDatabaseWork).mockImplementation((options, work) => work());
});

it.each([
  ["/wiki/12345/edit", "/wiki/:id/:id"],
  ["/api/v1/health", "/api/v1/health"],
  ["/login?next=/secret&token=abc", "/login"],
  ["/tasks/abc.data", "/tasks/:id"],
  ["/", "/"],
  ["", "/"],
  ["/projekte/ABC-1/aufgaben", "/projekte/:id/aufgaben"],
])("labels the route %s as %s", (url, expected) => {
  expect(safeRequestRoute(url)).toBe(expected);
});

it("keeps at most twelve path segments", () => {
  const url = `/${Array.from({ length: 20 }, () => "wiki").join("/")}`;

  expect(safeRequestRoute(url).split("/")).toHaveLength(12);
});

it("labels an unparsable target as invalid and reports the parse error", () => {
  expect(safeRequestRoute("http://")).toBe("/:invalid");
  expect(logCaughtError).toHaveBeenCalledWith(
    "RequestLogging",
    expect.any(TypeError),
  );
});

it("runs the handler once inside database work of class request", () => {
  const handle = vi.fn();

  logRequest(
    createRequest({ method: "GET", url: "/wiki/42" }),
    createResponse(),
    handle,
  );

  expect(handle).toHaveBeenCalledTimes(1);
  expect(withDatabaseWork).toHaveBeenCalledTimes(1);
  expect(vi.mocked(withDatabaseWork).mock.calls[0]?.[0]).toMatchObject({
    workClass: "request",
    origin: "/wiki/:id",
  });
});

it("sets the request id and uses it as the correlation id without a header", () => {
  const response = createResponse();

  logRequest(createRequest({ method: "GET", url: "/wiki" }), response, vi.fn());

  expect(response.getHeader("X-Request-ID")).toBe(REQUEST_ID);
  expect(response.getHeader("X-Correlation-ID")).toBe(REQUEST_ID);
  expect(logContexts).toEqual([
    { requestId: REQUEST_ID, correlationId: REQUEST_ID },
  ]);
});

it("adopts a valid correlation id of the client", () => {
  const response = createResponse();

  logRequest(
    createRequest({ method: "GET", url: "/wiki", correlation: "trace-42" }),
    response,
    vi.fn(),
  );

  expect(response.getHeader("X-Correlation-ID")).toBe("trace-42");
  expect(logContexts).toEqual([
    { requestId: REQUEST_ID, correlationId: "trace-42" },
  ]);
});

it("replaces a malformed correlation id with the request id", () => {
  const response = createResponse();

  logRequest(
    createRequest({ method: "GET", url: "/wiki", correlation: "bad id\n" }),
    response,
    vi.fn(),
  );

  expect(response.getHeader("X-Correlation-ID")).toBe(REQUEST_ID);
});

it("logs the start with safe facts only", () => {
  logRequest(
    createRequest({ method: "POST", url: "/wiki/secret-title?token=abc" }),
    createResponse(),
    vi.fn(),
  );

  expect(startedMetadata()).toEqual({
    requestId: REQUEST_ID,
    method: "POST",
    route: "/wiki/:id",
  });
});

it("reports an unknown method as OTHER", () => {
  logRequest(
    createRequest({ method: "PROPFIND", url: "/wiki" }),
    createResponse(),
    vi.fn(),
  );

  expect(startedMetadata()).toMatchObject({ method: "OTHER" });
});

it("reports a missing method as OTHER and a missing target as the root and still handles the request", () => {
  const handle = vi.fn();

  logRequest(createRequest({}), createResponse(), handle);

  expect(handle).toHaveBeenCalledTimes(1);

  expect(startedMetadata()).toEqual({
    requestId: REQUEST_ID,
    method: "OTHER",
    route: "/",
  });
});

it("keeps a status poll silent at the start", () => {
  logRequest(
    createRequest({ method: "GET", url: "/health" }),
    createResponse(),
    vi.fn(),
  );

  expect(logEvent).not.toHaveBeenCalled();
});

it("does not treat a POST to a polling address as a poll", () => {
  logRequest(
    createRequest({ method: "POST", url: "/health" }),
    createResponse(),
    vi.fn(),
  );

  expect(startedMetadata()).toMatchObject({ method: "POST", route: "/health" });
});

it("aborts the signal when the client closes before the response finished", () => {
  const response = createResponse();
  logRequest(createRequest({ method: "GET", url: "/wiki" }), response, vi.fn());
  const { signal } = databaseWorkOptions();

  expect(signal?.aborted).toBe(false);

  response.emit("close");

  expect(signal?.aborted).toBe(true);
});

it("keeps the signal intact when the response finished before it closed", () => {
  const response = createResponse();
  logRequest(createRequest({ method: "GET", url: "/wiki" }), response, vi.fn());
  const { signal } = databaseWorkOptions();

  response.emit("finish");
  response.emit("close");

  expect(signal?.aborted).toBe(false);
});

it("logs the completion of the request through its lifecycle", () => {
  const response = createResponse();
  logRequest(createRequest({ method: "GET", url: "/wiki" }), response, vi.fn());
  response.statusCode = 200;

  response.emit("finish");

  expect(vi.mocked(logEvent).mock.calls.map(([event]) => event.event)).toEqual([
    "http.request.started",
    "http.request.completed",
  ]);
});

it("reports a plain GET with its method", () => {
  logRequest(
    createRequest({ method: "GET", url: "/wiki" }),
    createResponse(),
    vi.fn(),
  );

  expect(startedMetadata()).toMatchObject({ method: "GET" });
});
