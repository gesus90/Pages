import { expect, it } from "vitest";

import { readAgentAnswer } from "./StoredAgentAnswer";

it("reads no measurement from an empty column", () => {
  expect(readAgentAnswer([null], 0)).toEqual({});
});

it("reads the recorded answer", () => {
  const agentAnswer = {
    answerId: "a1",
    durationMs: 12,
    tools: [
      {
        callId: "c1",
        name: "read",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  expect(readAgentAnswer(["x", JSON.stringify(agentAnswer)], 1)).toEqual({
    agentAnswer,
  });
});

it("rejects a malformed measurement", () => {
  expect(() => readAgentAnswer(['{"answerId":1}'], 0)).toThrow();
});
