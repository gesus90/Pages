import { describe, expect, it } from "vitest";

import { agentApiFailure } from "@/app/lib/agent-api-response.server";

describe("agentApiFailure", () => {
  it("answers with a fixed uncacheable envelope", async () => {
    const response = agentApiFailure("INVALID_REQUEST", 400);

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      apiVersion: "1",
      error: {
        code: "INVALID_REQUEST",
        message: "The agent API request was rejected.",
        retryable: false,
      },
    });
  });

  it("does not reveal whether a missing object exists", async () => {
    const response = agentApiFailure("NOT_FOUND", 404);

    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND", message: "Not found or no access." },
    });
  });

  it("offers a bearer challenge only for a 401", () => {
    expect(
      agentApiFailure("AUTH_REQUIRED", 401).headers.get("WWW-Authenticate"),
    ).toBe("Bearer");
    expect(
      agentApiFailure("FORBIDDEN", 403).headers.has("WWW-Authenticate"),
    ).toBe(false);
  });

  it("names the allowed method only for a 405", () => {
    expect(
      agentApiFailure("METHOD_NOT_ALLOWED", 405).headers.get("Allow"),
    ).toBe("POST");
    expect(agentApiFailure("INVALID_REQUEST", 400).headers.has("Allow")).toBe(
      false,
    );
  });

  it("tells the agent how to attach a ticket image instead of linking it", async () => {
    const details = { reason: "ticket_attachment_upload_required" } as const;
    const response = agentApiFailure("INVALID_REQUEST", 400, details);

    expect(await response.json()).toEqual({
      apiVersion: "1",
      error: {
        code: "INVALID_REQUEST",
        message:
          "Upload the image or file as an attachment to this ticket. Temporary uploads must be available, unexpired and owned by you; external image addresses are not allowed.",
        retryable: false,
        details,
      },
    });
  });

  it("keeps the generic message for other rejection reasons", async () => {
    const response = agentApiFailure("NOT_FOUND", 404, {
      reason: "graph_invalid",
      issues: [],
    });

    expect(await response.json()).toMatchObject({
      error: { message: "Not found or no access." },
    });
  });

  it("includes details only when given", async () => {
    const details = { constraint: "requestBytes", limit: 65_536 } as const;
    const withDetails = agentApiFailure("PAYLOAD_TOO_LARGE", 413, details);
    const without = agentApiFailure("PAYLOAD_TOO_LARGE", 413);

    expect(await withDetails.json()).toMatchObject({ error: { details } });
    expect(await without.json()).toEqual({
      apiVersion: "1",
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "The agent API request was rejected.",
        retryable: false,
      },
    });
  });
});
