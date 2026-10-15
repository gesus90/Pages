import { describe, expect, it } from "vitest";

import {
  authorizationFailure,
  authorizationResponse,
  readAuthorizationJson,
  requireAuthorizationOrigin,
} from "@/app/lib/authorization-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import { SYNTHETIC_ORIGIN } from "./request-fixtures";

function jsonRequest(
  body: string,
  contentType: string | null = "application/json",
): Request {
  const headers: Record<string, string> = {};

  if (contentType !== null) {
    headers["content-type"] = contentType;
  }

  return new Request(`${SYNTHETIC_ORIGIN}/api/v1/pairing`, {
    body,
    headers,
    method: "POST",
  });
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error: unknown) {
    return error;
  }

  throw new Error("Expected a rejection.");
}

describe("authorizationResponse", () => {
  it("is never cacheable and not sniffable", async () => {
    const response = authorizationResponse({ ok: true });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("uses the given status", () => {
    expect(authorizationResponse({}, 201).status).toBe(201);
  });
});

describe("authorizationFailure", () => {
  it("reports the code and status of an authorization error", async () => {
    const response = authorizationFailure(
      new McpAuthorizationError("access_denied", 403),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "access_denied" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("hides the message of an unexpected failure", async () => {
    const response = authorizationFailure(
      new Error("password=hunter2 at /srv/pages"),
    );
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ error: "temporarily_unavailable" });
    expect(text).not.toContain("hunter2");
  });

  it.each([undefined, null, "boom", { code: "access_denied", status: 403 }])(
    "treats the non-error value %j as unavailable",
    async (failure) => {
      const response = authorizationFailure(failure);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "temporarily_unavailable",
      });
    },
  );
});

describe("readAuthorizationJson", () => {
  it("returns a JSON object", async () => {
    const input = await readAuthorizationJson(jsonRequest('{"code":"A"}'));

    expect(input).toEqual({ code: "A" });
  });

  it("accepts a content type with parameters", async () => {
    const request = jsonRequest("{}", "application/json; charset=utf-8");

    expect(await readAuthorizationJson(request)).toEqual({});
  });

  it.each([
    ["a missing content type", "{}", null],
    ["a form content type", "{}", "application/x-www-form-urlencoded"],
    ["a text content type", "{}", "text/plain"],
    ["malformed JSON", "{", "application/json"],
    ["an array", "[]", "application/json"],
    ["a string", '"x"', "application/json"],
    ["null", "null", "application/json"],
    ["a number", "7", "application/json"],
  ])("rejects %s as an invalid request", async (caseName, body, type) => {
    const error = await rejection(
      readAuthorizationJson(jsonRequest(body, type)),
    );

    expect(error).toBeInstanceOf(McpAuthorizationError);
    expect(error).toMatchObject({ code: "invalid_request", status: 400 });
  });

  it("limits the body to 64 KiB", async () => {
    const wrap = (length: number): string =>
      JSON.stringify({ text: "x".repeat(length) });
    const fitting = wrap(65_536 - '{"text":""}'.length);
    const oversized = wrap(65_536 - '{"text":""}'.length + 1);

    expect(fitting.length).toBe(65_536);
    expect(await readAuthorizationJson(jsonRequest(fitting))).toBeTypeOf(
      "object",
    );
    expect(
      await rejection(readAuthorizationJson(jsonRequest(oversized))),
    ).toMatchObject({ code: "invalid_request" });
  });
});

describe("requireAuthorizationOrigin", () => {
  function from(origin: string | null): Request {
    const headers: Record<string, string> = {};

    if (origin !== null) {
      headers.origin = origin;
    }

    return new Request(`${SYNTHETIC_ORIGIN}/pair`, { headers, method: "POST" });
  }

  it("accepts the own origin", () => {
    expect(() =>
      requireAuthorizationOrigin(from(SYNTHETIC_ORIGIN)),
    ).not.toThrow();
  });

  it.each([null, "http://evil.invalid", "null", "https://pages.invalid"])(
    "refuses the origin %j",
    (origin) => {
      expect(() => requireAuthorizationOrigin(from(origin))).toThrow(
        McpAuthorizationError,
      );
      try {
        requireAuthorizationOrigin(from(origin));
      } catch (error: unknown) {
        expect(error).toMatchObject({ code: "access_denied", status: 403 });
      }
    },
  );
});
