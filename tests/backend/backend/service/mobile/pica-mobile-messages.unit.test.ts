import { describe, expect, it } from "vitest";

import {
  encodePicaMobileConnected,
  encodePicaMobileError,
  encodePicaMobilePong,
  parsePicaMobileMessage,
} from "@/backend/service/mobile/PicaMobileMessages";

const ANY_TEXT: unknown = expect.any(String);

function frame(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    version: 1,
    type: "ping",
    requestId: "r-1",
    payload: {},
    ...overrides,
  });
}

function rejectionOf(text: string): {
  code: string;
  requestId: string | null;
  supportedVersions?: readonly number[];
} {
  const result = parsePicaMobileMessage(text);

  if (result.ok) {
    throw new Error("Expected a rejection.");
  }

  return result.rejection;
}

describe("valid messages", () => {
  it("reads a ping", () => {
    expect(parsePicaMobileMessage(frame({}))).toEqual({
      ok: true,
      message: { type: "ping", requestId: "r-1" },
    });
  });

  it("reads a session authentication", () => {
    const payload = { method: "session", token: "abc" };

    expect(
      parsePicaMobileMessage(frame({ type: "auth", payload })),
    ).toEqual({
      ok: true,
      message: { type: "auth", requestId: "r-1", payload },
    });
  });

  it("reads a password authentication and ignores unknown payload fields", () => {
    const result = parsePicaMobileMessage(
      frame({
        type: "auth",
        payload: {
          method: "password",
          username: "anna",
          password: "secret",
          extra: true,
        },
      }),
    );

    expect(result).toEqual({
      ok: true,
      message: {
        type: "auth",
        requestId: "r-1",
        payload: { method: "password", username: "anna", password: "secret" },
      },
    });
  });
});

describe("rejected frames", () => {
  it.each(["not json", "[]", "null", "42", '"text"'])(
    "rejects %s as an invalid message without a request id",
    (text) => {
      expect(rejectionOf(text)).toEqual({
        code: "invalid_message",
        message: ANY_TEXT,
        requestId: null,
      });
    },
  );

  it.each([undefined, "1", 1.5, null])(
    "rejects the version %j as invalid",
    (version) => {
      expect(rejectionOf(frame({ version })).code).toBe("invalid_message");
    },
  );

  it("names the supported versions for an unsupported one and keeps the request id", () => {
    expect(rejectionOf(frame({ version: 2 }))).toEqual({
      code: "unsupported_version",
      message: "Protocol version 2 is not supported.",
      requestId: "r-1",
      supportedVersions: [1],
    });
  });

  it("judges the version before the shape of a newer message", () => {
    expect(
      rejectionOf(JSON.stringify({ version: 7, kind: "other" })).code,
    ).toBe("unsupported_version");
  });

  it.each([undefined, "", "has space", "x".repeat(65), 5, "<script>"])(
    "rejects the request id %j",
    (requestId) => {
      expect(rejectionOf(frame({ requestId }))).toMatchObject({
        code: "invalid_message",
        requestId: null,
      });
    },
  );

  it("rejects a missing or non-text type", () => {
    expect(rejectionOf(frame({ type: undefined })).code).toBe(
      "invalid_message",
    );
    expect(rejectionOf(frame({ type: 3 })).code).toBe("invalid_message");
  });

  it.each([undefined, null, [], "text"])(
    "rejects the payload %j",
    (payload) => {
      expect(rejectionOf(frame({ payload }))).toMatchObject({
        code: "invalid_message",
        requestId: "r-1",
      });
    },
  );

  it("rejects an unknown type with the request id", () => {
    expect(rejectionOf(frame({ type: "chat.send" }))).toMatchObject({
      code: "unknown_type",
      requestId: "r-1",
    });
  });

  it.each([
    { method: "session" },
    { method: "session", token: "" },
    { method: "session", token: "x".repeat(257) },
    { method: "password", username: "anna" },
    { method: "password", username: "", password: "x" },
    { method: "password", username: "a", password: "x".repeat(1001) },
    { method: "oauth", token: "x" },
    {},
  ])("rejects the authentication payload %j", (payload) => {
    expect(rejectionOf(frame({ type: "auth", payload }))).toMatchObject({
      code: "invalid_message",
      requestId: "r-1",
    });
  });

  it("never repeats submitted credentials in the rejection", () => {
    const text = frame({
      type: "auth",
      payload: { method: "password", username: "anna", password: 7 },
    });

    expect(JSON.stringify(rejectionOf(text))).not.toContain("anna");
  });
});

describe("encoders", () => {
  it("builds an error with hints only when they are set", () => {
    expect(
      JSON.parse(
        encodePicaMobileError({
          code: "invalid_message",
          message: "No.",
          requestId: null,
        }),
      ),
    ).toEqual({
      version: 1,
      type: "error",
      requestId: null,
      payload: { code: "invalid_message", message: "No." },
    });
    expect(
      JSON.parse(
        encodePicaMobileError({
          code: "unsupported_version",
          message: "No.",
          requestId: "r-2",
          supportedVersions: [1],
          retryAfterSeconds: 30,
        }),
      ).payload,
    ).toEqual({
      code: "unsupported_version",
      message: "No.",
      supportedVersions: [1],
      retryAfterSeconds: 30,
    });
  });

  it("builds the connected and the pong message", () => {
    const connected: unknown = JSON.parse(
      encodePicaMobileConnected("r-3", {
        connectionId: "c-1",
        user: { id: "u", username: "anna", displayName: "Anna" },
        sessionToken: null,
        heartbeat: { intervalMilliseconds: 1, timeoutMilliseconds: 2 },
        server: { version: "1.0.0", protocolVersions: [1] },
      }),
    );

    expect(connected).toMatchObject({
      version: 1,
      type: "connected",
      requestId: "r-3",
      payload: { connectionId: "c-1", sessionToken: null },
    });
    expect(
      JSON.parse(
        encodePicaMobilePong("r-4", new Date("2026-10-23T10:00:00.000Z")),
      ),
    ).toEqual({
      version: 1,
      type: "pong",
      requestId: "r-4",
      payload: { serverTime: "2026-10-23T10:00:00.000Z" },
    });
  });
});
