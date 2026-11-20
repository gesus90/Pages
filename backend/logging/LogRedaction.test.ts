import { afterEach, expect, it, vi } from "vitest";

import {
  redactLogText,
  registerLogSecret,
  safeLogMetadata,
} from "./LogRedaction";

const REDACTED = "[REDACTED]";

afterEach(() => {
  vi.unstubAllEnvs();
});

it.each([
  [
    "a complete private key block",
    "before -----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY----- after",
    `before ${REDACTED} after`,
  ],
  [
    "an unterminated private key block",
    "-----BEGIN PRIVATE KEY-----\nMIIB",
    REDACTED,
  ],
  ["a bearer token", "Bearer abc.def-123", REDACTED],
  ["a basic credential", "Basic dXNlcjpwYXNz", REDACTED],
  ["a cookie header", "Cookie: session=abc; theme=dark", REDACTED],
  ["a set-cookie header", "set-cookie: id=1; Path=/", REDACTED],
  [
    "a JSON web token",
    "token eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl",
    `token ${REDACTED}`,
  ],
  ["a GitHub token", "gho_abcdef123456", REDACTED],
  ["a fine-grained GitHub token", "github_pat_11AAA", REDACTED],
  ["an OpenAI-style key", "sk-proj-abcdefgh", REDACTED],
  ["a Slack token", "xoxb-1234-abcd", REDACTED],
  [
    "the password of a database URL",
    "postgres://pages:hunter2@db.internal/pages",
    `postgres://${REDACTED}@db.internal/pages`,
  ],
  [
    "query parameter values",
    "/callback?code=abc&state=xyz#top",
    `/callback?code=${REDACTED}&state=${REDACTED}#top`,
  ],
  [
    "a quoted password assignment",
    'password: "hunter2"',
    `password: ${REDACTED}`,
  ],
  ["an unquoted api key assignment", "api_key=abc123", `api_key=${REDACTED}`],
  [
    "a single-quoted token assignment",
    "token: 'value-1'",
    `token: ${REDACTED}`,
  ],
])("redacts %s", (description, input, expected) => {
  expect(redactLogText(input)).toBe(expected);
});

it("leaves ordinary operational text unchanged", () => {
  const text = "Plan run completed in 42 ms for project Alpha";

  expect(redactLogText(text)).toBe(text);
});

it("redacts registered instance secrets wherever they appear", () => {
  registerLogSecret("instance-secret-1");
  registerLogSecret("abc");

  expect(redactLogText("key instance-secret-1 and abc")).toBe(
    `key ${REDACTED} and abc`,
  );
});

it("redacts environment values whose variable names are secret-like", () => {
  vi.stubEnv("PAGES_TEST_SERVICE_TOKEN", "env-token-value");
  vi.stubEnv("PAGES_TEST_SHORT_SECRET", "abc");
  vi.stubEnv("PAGES_TEST_PUBLIC_NAME", "public-name-value");

  expect(redactLogText("env-token-value abc public-name-value")).toBe(
    `${REDACTED} abc public-name-value`,
  );
});

it("truncates text beyond 4000 characters and marks the cut", () => {
  const redacted = redactLogText("x".repeat(4_010));

  expect(redacted).toBe(`${"x".repeat(4_000)}[TRUNCATED]`);
});

it("stops registering secrets once 256 are known", async () => {
  vi.resetModules();
  const redaction = await import("./LogRedaction");

  for (let index = 0; index < 256; index += 1) {
    redaction.registerLogSecret(`known-secret-${index}`);
  }
  redaction.registerLogSecret("overflow-secret");

  expect(redaction.redactLogText("known-secret-0 overflow-secret")).toBe(
    `${REDACTED} overflow-secret`,
  );
});

it("keeps only allowlisted primitive operational metadata", () => {
  expect(
    safeLogMetadata({
      requestId: "request-1",
      statusCode: 404,
      isConfirmed: false,
      deleted: null,
      durationMs: 12.5,
      model: "model-a",
    }),
  ).toEqual({
    requestId: "request-1",
    statusCode: 404,
    isConfirmed: false,
    deleted: null,
    durationMs: 12.5,
    model: "model-a",
  });
});

it("drops secret, content and unknown keys and marks the record as truncated", () => {
  expect(
    safeLogMetadata({
      password: "hunter2",
      body: "user text",
      unknownField: "value",
      count: 1,
    }),
  ).toEqual({ count: 1, truncated: true });
});

it("drops values that are not primitives or finite numbers", () => {
  expect(
    safeLogMetadata({
      count: Number.NaN,
      rows: { nested: true },
      route: ["/a"],
      status: 200,
    }),
  ).toEqual({ status: 200, truncated: true });
});

it("redacts and bounds long allowlisted strings", () => {
  const safe = safeLogMetadata({
    route: `Bearer abc123 ${"r".repeat(300)}`,
  });

  expect(safe.route).toBe(
    `${REDACTED} ${"r".repeat(256 - REDACTED.length - 1)}`,
  );
  expect(safe.truncated).toBe(true);
});

it("keeps at most 32 keys and records that more were present", () => {
  const metadata: Record<string, number> = {};
  for (let index = 0; index < 33; index += 1) {
    metadata[index === 0 ? "count" : `unknownKey${index}`] = index;
  }

  const safe = safeLogMetadata(metadata);

  expect(safe).toEqual({ count: 0, truncated: true });
});

it("returns an empty object without metadata", () => {
  expect(safeLogMetadata()).toEqual({});
});
