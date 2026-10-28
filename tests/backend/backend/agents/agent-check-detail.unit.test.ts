import { expect, it } from "vitest";

import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";

it.each([null, "detail", 3])("returns no detail for %j", (input) => {
  expect(sanitizeCheckDetail(input)).toEqual({});
});

it("keeps only known, well-formed measurements", () => {
  expect(
    sanitizeCheckDetail({
      modelCount: 3,
      limitRemaining: -1,
      inputTokens: Number.NaN,
      outputTokens: "4",
      costUsd: 0,
      hasMoreModels: true,
      isFreeTier: "no",
      reasoningEffort: "high",
      model: "openai/gpt-5",
      endpoint: "https://example.invalid/v1",
      cliVersion: "bad version",
      modelProvider: "x".repeat(201),
      authMethod: "chatgpt",
      secret: "token",
    }),
  ).toEqual({
    modelCount: 3,
    costUsd: 0,
    hasMoreModels: true,
    reasoningEffort: "high",
    model: "openai/gpt-5",
    endpoint: "https://example.invalid/v1",
    authMethod: "chatgpt",
  });
});

it("leaves out an unknown reasoning effort and authentication method", () => {
  expect(
    sanitizeCheckDetail({ reasoningEffort: 7, authMethod: "password" }),
  ).toEqual({});
});
