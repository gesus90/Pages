import { expect, it } from "vitest";

import {
  readSessionCursor,
  readSessionHistoryWindow,
  readSessionKey,
} from "@/app/lib/agent-session-request.server";
import { AgentError } from "@/backend/error/AgentErrors";

function errorCode(work: () => unknown): string {
  try {
    work();
  } catch (error: unknown) {
    if (error instanceof AgentError) return error.code;
    throw error;
  }
  throw new Error("Expected an agent error.");
}

it("reads the session key from the route and the query", () => {
  const search = new URLSearchParams({
    planId: " plan ",
    attemptId: `process:${"n".repeat(250)}`,
  });

  expect(readSessionKey({ runId: "run", stepId: "step" }, search)).toEqual({
    planId: "plan",
    runId: "run",
    stepId: "step",
    attemptId: `process:${"n".repeat(250)}`,
  });
});

it("refuses a session key with a missing or oversized part", () => {
  const search = new URLSearchParams({ planId: "plan", attemptId: "a" });

  expect(errorCode(() => readSessionKey({ runId: "run" }, search))).toBe(
    "plan_invalid",
  );
  expect(
    errorCode(() =>
      readSessionKey(
        { runId: "run", stepId: "step" },
        new URLSearchParams({ planId: "plan", attemptId: "a".repeat(301) }),
      ),
    ),
  ).toBe("plan_invalid");
});

it("reads a missing cursor as the start and digits as a position", () => {
  expect(readSessionCursor(null)).toBe(0);
  expect(readSessionCursor("42")).toBe(42);
});

it("refuses a cursor that is not a safe non-negative integer", () => {
  for (const input of ["-1", "1.5", "", "abc", "9".repeat(20)]) {
    expect(errorCode(() => readSessionCursor(input))).toBe("plan_invalid");
  }
});

it("reads a forward window after a cursor", () => {
  expect(
    readSessionHistoryWindow(new URLSearchParams({ after: "5" }), 50),
  ).toEqual({ after: 5, limit: 50 });
});

it("reads a backward window before a cursor", () => {
  expect(
    readSessionHistoryWindow(new URLSearchParams({ before: "9" }), 20),
  ).toEqual({ after: 0, before: 9, limit: 20 });
});

it("reads a tail window and an explicit non-tail selector", () => {
  expect(
    readSessionHistoryWindow(new URLSearchParams({ tail: "1" }), 10),
  ).toEqual({ after: 0, tail: true, limit: 10 });
  expect(
    readSessionHistoryWindow(new URLSearchParams({ tail: "0" }), 10),
  ).toEqual({ after: 0, limit: 10 });
});

it("refuses an unknown selector or conflicting window bounds", () => {
  const conflicts: Record<string, string>[] = [
    { tail: "yes" },
    { before: "0" },
    { before: "3", tail: "1" },
    { before: "3", after: "1" },
    { tail: "1", after: "2" },
  ];

  for (const query of conflicts) {
    expect(
      errorCode(() => readSessionHistoryWindow(new URLSearchParams(query), 5)),
    ).toBe("plan_invalid");
  }
});
