import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  DATA_REQUEST_HEADER,
  REDIRECT_HEADER,
} from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";

interface Payload {
  readonly name: string;
}

const isPayload = (value: unknown): value is Payload =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string";

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function read(): Promise<Payload> {
  return readRouteData({
    endpoint: "/api/route?x=1",
    signal: new AbortController().signal,
    isPayload,
  });
}

async function rejection(): Promise<unknown> {
  try {
    await read();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected the read to fail");
}

it("reads the payload uncached with the data request header", async () => {
  const controller = new AbortController();
  fetchMock.mockResolvedValue(Response.json({ name: "Pages" }));

  const payload = await readRouteData({
    endpoint: "/api/route?x=1",
    signal: controller.signal,
    isPayload,
  });

  expect(payload).toEqual({ name: "Pages" });
  const [endpoint, init] = fetchMock.mock.calls[0] ?? [];
  expect(endpoint).toBe("/api/route?x=1");
  expect(init?.cache).toBe("no-store");
  expect(init?.signal).toBe(controller.signal);
  const headers = new Headers(init?.headers);
  expect(headers.get("Accept")).toBe("application/json");
  expect(headers.get(DATA_REQUEST_HEADER)).toBe("1");
});

it("turns a redirect the API answers into a redirect of the route", async () => {
  fetchMock.mockResolvedValue(
    new Response(null, {
      status: 204,
      headers: { [REDIRECT_HEADER]: "/login" },
    }),
  );

  const error = await rejection();

  expect(error).toBeInstanceOf(Response);
  expect((error as Response).status).toBe(302);
  expect((error as Response).headers.get("Location")).toBe("/login");
});

it("throws a refusal with the endpoint's status, text and content type", async () => {
  fetchMock.mockResolvedValue(
    new Response("Forbidden here", {
      status: 403,
      statusText: "Forbidden",
      headers: { "Content-Type": "text/plain", "X-Other": "dropped" },
    }),
  );

  const error = await rejection();

  expect(error).toBeInstanceOf(Response);
  const response = error as Response;
  expect(response.status).toBe(403);
  expect(response.statusText).toBe("Forbidden");
  expect(response.headers.get("Content-Type")).toContain("text/plain");
  expect(response.headers.get("X-Other")).toBeNull();
  expect(await response.text()).toBe("Forbidden here");
});

it("throws an error answer without a content type with the default text type", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

  const error = await rejection();

  expect((error as Response).status).toBe(500);
  expect((error as Response).headers.get("Content-Type")).toContain(
    "text/plain",
  );
  expect(await (error as Response).text()).toBe("");
});

it("refuses a payload of an unexpected shape", async () => {
  fetchMock.mockResolvedValue(Response.json({ name: 5 }));

  const error = await rejection();

  expect((error as Response).status).toBe(500);
  expect(await (error as Response).text()).toBe("Unexpected route data");
});

it("lets a failed connection surface as the TypeError of fetch", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

  await expect(read()).rejects.toThrow(TypeError);
});
