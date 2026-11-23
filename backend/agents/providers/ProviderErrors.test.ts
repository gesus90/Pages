import { describe, expect, it } from "vitest";

import { classifyProviderError } from "@/backend/agents/providers/ProviderErrors";

describe("classifyProviderError", () => {
  it.each([
    [401, null, "provider_auth_failed"],
    [200, { error: { code: "API_KEY_INVALID" } }, "provider_auth_failed"],
    [402, null, "provider_quota_exhausted"],
    [
      200,
      { error: { type: "insufficient_quota" } },
      "provider_quota_exhausted",
    ],
    [403, null, "provider_permission_denied"],
    [404, null, "provider_model_not_found"],
    [200, { error: { code: "model_not_found" } }, "provider_model_not_found"],
    [429, null, "provider_rate_limited"],
    [503, null, "provider_unavailable"],
    [599, null, "provider_unavailable"],
    [400, null, "provider_request_rejected"],
    [418, null, "provider_request_rejected"],
    [200, { error: { code: 400 } }, "provider_request_rejected"],
    [302, null, "provider_bad_response"],
    [100, null, "provider_bad_response"],
    [200, { error: {} }, "provider_bad_response"],
  ] as const)("maps %s with %j to %s", (status, payload, expected) => {
    expect(classifyProviderError(status, payload)).toBe(expected);
  });

  it("reads structured codes from error details and skips other types", () => {
    expect(
      classifyProviderError(200, {
        error: { code: {}, details: [{ reason: "API_KEY_INVALID" }, 5] },
      }),
    ).toBe("provider_auth_failed");
  });

  it("returns null for a plain success", () => {
    expect(classifyProviderError(200, { data: [] })).toBeNull();
  });
});
