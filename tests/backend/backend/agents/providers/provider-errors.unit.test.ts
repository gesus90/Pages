import { expect, it } from "vitest";

import { classifyProviderError } from "@/backend/agents/providers/ProviderErrors";

it.each([
  [401, {}, "provider_auth_failed"],
  [200, { error: { code: "insufficient_quota" } }, "provider_quota_exhausted"],
  [200, { error: { status: 1220 } }, "provider_permission_denied"],
  [200, { error: { type: "model_not_found" } }, "provider_model_not_found"],
  [429, {}, "provider_rate_limited"],
  [503, {}, "provider_unavailable"],
] as const)(
  "maps status %i with payload %j to %s",
  (status, payload, expected) => {
    expect(classifyProviderError(status, payload)).toBe(expected);
  },
);

it("reads structured reasons from Google error details", () => {
  expect(
    classifyProviderError(400, {
      error: {
        details: [{ reason: "API_KEY_INVALID" }, "not an object", null],
      },
    }),
  ).toBe("provider_auth_failed");
});

it("treats unknown server errors as unavailable and unknown client errors as rejected", () => {
  expect(classifyProviderError(501, null)).toBe("provider_unavailable");
  expect(classifyProviderError(418, null)).toBe("provider_request_rejected");
  expect(classifyProviderError(200, { error: { code: 400 } })).toBe(
    "provider_request_rejected",
  );
});

it("treats non-success statuses and wrapped errors as bad responses", () => {
  expect(classifyProviderError(302, {})).toBe("provider_bad_response");
  expect(classifyProviderError(199, {})).toBe("provider_bad_response");
  expect(classifyProviderError(200, { error: "unexpected" })).toBe(
    "provider_bad_response",
  );
});

it("accepts a plain successful response", () => {
  expect(classifyProviderError(200, { data: [] })).toBeNull();
});
