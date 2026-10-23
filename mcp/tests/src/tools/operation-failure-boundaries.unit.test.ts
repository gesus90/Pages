import { describe, expect, it } from "vitest";

import { operationFailure } from "../../../src/tools/operation-failure.ts";

const CANDIDATES = Array.from({ length: 100 }, (_, index) => ({
  id: `project-${index}`,
  name: `Project ${index}`,
}));
const AMBIGUITIES = [
  { candidates: [], truncated: false },
  { candidates: CANDIDATES, truncated: true },
];
const SAFE_INTEGERS = [1, Number.MAX_SAFE_INTEGER];
const UNSAFE_INTEGERS = [-1, Number.MAX_SAFE_INTEGER + 1];

function rejection(status: number, code: string, details: unknown): Response {
  return Response.json(
    {
      apiVersion: "1",
      error: { code, details, message: "private diagnostic" },
    },
    { status },
  );
}

describe("operationFailure boundary details", () => {
  it.each(AMBIGUITIES)(
    "accepts the candidate boundary with truncated=$truncated",
    async (details) => {
      const failure = await operationFailure(
        rejection(409, "AMBIGUOUS", { ...details, privateField: "discard" }),
      );

      expect(failure?.code).toBe("AMBIGUOUS");
      expect(failure?.details).toEqual(details);
      expect(failure?.message).toBe("The agent API request was rejected.");
    },
  );

  it.each(SAFE_INTEGERS)(
    "accepts the positive safe limit boundary %i without extra fields",
    async (limit) => {
      const failure = await operationFailure(
        rejection(413, "PAYLOAD_TOO_LARGE", {
          constraint: "importFiles",
          limit,
          privateField: "discard",
        }),
      );

      expect(failure?.code).toBe("PAYLOAD_TOO_LARGE");
      expect(failure?.details).toEqual({ constraint: "importFiles", limit });
    },
  );

  it.each(SAFE_INTEGERS)(
    "prefers the valid revision boundary %i over a rejection reason",
    async (currentRevision) => {
      const failure = await operationFailure(
        rejection(409, "CONFLICT", {
          currentRevision,
          reason: "agent_running",
          privateField: "discard",
        }),
      );

      expect(failure?.code).toBe("CONFLICT");
      expect(failure?.details).toEqual({ currentRevision });
    },
  );

  it.each(UNSAFE_INTEGERS)(
    "falls back to the public reason for the unsafe revision %i",
    async (currentRevision) => {
      const failure = await operationFailure(
        rejection(409, "CONFLICT", {
          currentRevision,
          reason: "agent_running",
        }),
      );

      expect(failure?.code).toBe("CONFLICT");
      expect(failure?.details).toEqual({ reason: "agent_running" });
    },
  );
});
