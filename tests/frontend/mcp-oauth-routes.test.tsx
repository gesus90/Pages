import { describe, expect, it } from "vitest";

import {
  oauthFailure,
  oauthResponse,
  readOAuthJson,
  requireOAuthOrigin,
} from "@/app/lib/oauth-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

function jsonRequest(
  input: unknown,
  method = "POST",
  path = "/api/v1/personal-tokens",
): Request {
  return new Request(`https://pages.invalid${path}`, {
    method,
    headers: {
      Origin: "https://pages.invalid",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

describe("bounded credential-safe request/response support", () => {
  it("rejects wrong media type, oversized, invalid or non-object JSON", async () => {
    for (const request of [
      new Request("https://pages.invalid", { method: "POST", body: "{}" }),
      jsonRequest("x".repeat(65537)),
      jsonRequest(null),
      jsonRequest(3),
      jsonRequest([]),
      new Request("https://pages.invalid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    ])
      await expect(readOAuthJson(request)).rejects.toMatchObject({
        code: "invalid_request",
      });
    expect(await readOAuthJson(jsonRequest({ operation: "test" }))).toEqual({
      operation: "test",
    });
    expect(oauthResponse({}).status).toBe(200);
    expect(oauthFailure(new Error("secret")).status).toBe(503);
    expect(
      oauthFailure(new McpAuthorizationError("invalid_token", 401)).status,
    ).toBe(401);
    expect(() =>
      requireOAuthOrigin(
        new Request("https://pages.invalid", {
          headers: { Origin: "https://evil.invalid" },
        }),
      ),
    ).toThrow(McpAuthorizationError);
  });
});
