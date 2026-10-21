import { describe, expect, it } from "vitest";

import {
  operationFailure,
  PagesOperationError,
} from "../../../src/tools/operation-failure.ts";

function failureResponse(status: number, error: unknown): Response {
  return new Response(JSON.stringify({ apiVersion: "1", error }), { status });
}

describe("PagesOperationError", () => {
  it("uses the fixed not-found message", () => {
    const failure = new PagesOperationError("NOT_FOUND");
    expect(failure.message).toBe("Not found or no access.");
    expect(failure.details).toBeUndefined();
  });

  it("uses one generic message for every other code", () => {
    const failure = new PagesOperationError("CONFLICT", {
      currentRevision: 3,
    });
    expect(failure.message).toBe("The agent API request was rejected.");
    expect(failure.code).toBe("CONFLICT");
    expect(failure.details).toEqual({ currentRevision: 3 });
  });
});

describe("operationFailure envelope", () => {
  it("ignores a body that is not JSON", async () => {
    await expect(
      operationFailure(new Response("<html>", { status: 404 })),
    ).resolves.toBeUndefined();
  });

  it.each([null, "NOT_FOUND", 404])(
    "ignores the non-object JSON body %j",
    async (body) => {
      await expect(
        operationFailure(new Response(JSON.stringify(body), { status: 404 })),
      ).resolves.toBeUndefined();
    },
  );

  it.each([
    { apiVersion: "2", error: { code: "NOT_FOUND" } },
    { apiVersion: "1", error: "NOT_FOUND" },
    { apiVersion: "1", error: null },
    { apiVersion: "1" },
  ])("ignores the unexpected envelope %j", async (body) => {
    await expect(
      operationFailure(new Response(JSON.stringify(body), { status: 404 })),
    ).resolves.toBeUndefined();
  });

  it("ignores codes outside the public whitelist", async () => {
    await expect(
      operationFailure(failureResponse(401, { code: "UNAUTHORIZED" })),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["NOT_FOUND", 404],
    ["INVALID_REQUEST", 400],
    ["PAYLOAD_TOO_LARGE", 413],
    ["CONFLICT", 409],
    ["FORBIDDEN", 403],
    ["CONFIRMATION_REQUIRED", 400],
  ])("accepts %s only with status %i", async (code, status) => {
    const failure = await operationFailure(failureResponse(status, { code }));
    expect(failure).toBeInstanceOf(PagesOperationError);
    expect(failure?.code).toBe(code);
    expect(failure?.details).toBeUndefined();
    await expect(
      operationFailure(failureResponse(500, { code })),
    ).resolves.toBeUndefined();
  });

  it("drops details of codes that carry none", async () => {
    const failure = await operationFailure(
      failureResponse(404, { code: "NOT_FOUND", details: { secret: "x" } }),
    );
    expect(failure?.details).toBeUndefined();
    expect(failure?.message).toBe("Not found or no access.");
  });
});

describe("operationFailure ambiguity", () => {
  const candidates = [
    { id: "p1", name: "Plan", extra: "dropped" },
    { id: "p2", name: "Plan" },
  ];

  it("returns visible candidates of an ambiguous name", async () => {
    const failure = await operationFailure(
      failureResponse(409, {
        code: "AMBIGUOUS",
        details: { candidates, truncated: true },
      }),
    );
    expect(failure?.code).toBe("AMBIGUOUS");
    expect(failure?.details).toEqual({
      candidates: [
        { id: "p1", name: "Plan" },
        { id: "p2", name: "Plan" },
      ],
      truncated: true,
    });
  });

  it.each([
    undefined,
    null,
    { candidates: "p1", truncated: false },
    { candidates, truncated: "no" },
    {
      candidates: Array.from({ length: 101 }, (_, index) => ({
        id: `p${index}`,
        name: "Plan",
      })),
      truncated: true,
    },
    { candidates: [null], truncated: false },
    { candidates: ["p1"], truncated: false },
    { candidates: [{ id: 1, name: "Plan" }], truncated: false },
    { candidates: [{ id: "p1", name: null }], truncated: false },
  ])("rejects the malformed ambiguity details %j", async (details) => {
    await expect(
      operationFailure(failureResponse(409, { code: "AMBIGUOUS", details })),
    ).resolves.toBeUndefined();
  });

  it("does not accept an ambiguity with another status", async () => {
    await expect(
      operationFailure(
        failureResponse(400, {
          code: "AMBIGUOUS",
          details: { candidates, truncated: false },
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("operationFailure limits", () => {
  it("keeps a recognized constraint with a positive limit", async () => {
    const failure = await operationFailure(
      failureResponse(413, {
        code: "PAYLOAD_TOO_LARGE",
        details: { constraint: "importFiles", limit: 32, path: "/secret" },
      }),
    );
    expect(failure?.details).toEqual({ constraint: "importFiles", limit: 32 });
  });

  it.each([
    null,
    [],
    "importFiles",
    { constraint: "diskBytes", limit: 32 },
    { constraint: "importFiles", limit: "32" },
    { constraint: "importFiles", limit: 1.5 },
    { constraint: "importFiles", limit: 0 },
    { constraint: "importFiles", limit: Number.MAX_SAFE_INTEGER + 1 },
  ])("drops the unsafe limit details %j", async (details) => {
    const failure = await operationFailure(
      failureResponse(413, { code: "PAYLOAD_TOO_LARGE", details }),
    );
    expect(failure?.code).toBe("PAYLOAD_TOO_LARGE");
    expect(failure?.details).toBeUndefined();
  });
});

describe("operationFailure conflicts and rejection reasons", () => {
  it("keeps the current revision of a conflict", async () => {
    const failure = await operationFailure(
      failureResponse(409, {
        code: "CONFLICT",
        details: { currentRevision: 7 },
      }),
    );
    expect(failure?.details).toEqual({ currentRevision: 7 });
  });

  it("falls back to a whitelisted reason of a conflict", async () => {
    const failure = await operationFailure(
      failureResponse(409, {
        code: "CONFLICT",
        details: { currentRevision: 0, reason: "agent_running" },
      }),
    );
    expect(failure?.details).toEqual({ reason: "agent_running" });
  });

  it.each([
    null,
    "7",
    {},
    { currentRevision: "7" },
    { currentRevision: 2.5 },
    { currentRevision: 0 },
  ])("drops the conflict details %j", async (details) => {
    const failure = await operationFailure(
      failureResponse(409, { code: "CONFLICT", details }),
    );
    expect(failure?.code).toBe("CONFLICT");
    expect(failure?.details).toBeUndefined();
  });

  it.each([
    ["INVALID_REQUEST", 400],
    ["FORBIDDEN", 403],
  ])("keeps a whitelisted reason of %s", async (code, status) => {
    const failure = await operationFailure(
      failureResponse(status, {
        code,
        details: { reason: "model_unavailable", model: "secret" },
      }),
    );
    expect(failure?.details).toEqual({ reason: "model_unavailable" });
  });

  it.each([
    { reason: "unknown_reason" },
    { reason: "toString" },
    { reason: 3 },
    { other: "model_unavailable" },
  ])("drops the unknown reason %j", async (details) => {
    const failure = await operationFailure(
      failureResponse(400, { code: "INVALID_REQUEST", details }),
    );
    expect(failure?.code).toBe("INVALID_REQUEST");
    expect(failure?.details).toBeUndefined();
  });
});

describe("operationFailure plan findings", () => {
  it.each(["unsupportedRunNotes"])(
    "keeps the node and public %s unsupported-placeholder diagnosis",
    async (problem) => {
      const issues = [{ nodeId: "notes-node", port: null, problem }];
      const failure = await operationFailure(
        failureResponse(400, {
          code: "INVALID_REQUEST",
          details: { reason: "graph_invalid", issues },
        }),
      );
      expect(failure?.details).toEqual({ reason: "graph_invalid", issues });
    },
  );

  it("preserves an explicit unsupported ticket handoff finding", async () => {
    const issues = [
      { nodeId: "next", port: "ticket", problem: "ticketHandoff" },
    ];
    const failure = await operationFailure(
      failureResponse(400, {
        code: "INVALID_REQUEST",
        details: { reason: "graph_invalid", issues },
      }),
    );
    expect(failure?.details).toEqual({ reason: "graph_invalid", issues });
  });
});
