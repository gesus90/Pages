import { describe, expect, it } from "vitest";

import {
  readAgentConnectionScope,
  readZaiAccountType,
  validateAgentInput,
} from "@/backend/service/agents/AgentConnectionValidation";

describe("agent connection input", () => {
  it("normalizes optional choices and preserves an existing z.ai account", () => {
    expect(validateAgentInput({ name: "  Work  " }, "openai")).toEqual({
      name: "Work",
      apiKey: null,
      testModel: null,
      reasoningEffort: null,
    });
    expect(
      validateAgentInput(
        {
          name: "Work",
          apiKey: "key",
          testModel: "model",
          reasoningEffort: "high",
        },
        "openai",
      ),
    ).toEqual({
      name: "Work",
      apiKey: "key",
      testModel: "model",
      reasoningEffort: "high",
    });
    expect(readZaiAccountType({ name: "Work" }, "zai", "coding-plan")).toBe(
      "coding-plan",
    );
    expect(readZaiAccountType({ name: "Work" }, "openai")).toBeUndefined();
    expect(() => readZaiAccountType({ name: "Work" }, "zai")).toThrowError(
      expect.objectContaining({ code: "zai_account_type_invalid" }),
    );
  });

  it.each([
    [{ name: "  " }, "openai", "name_required"],
    [{ name: "x".repeat(81) }, "openai", "name_too_long"],
    [{ name: "x", apiKey: "key" }, "codex_cli", "api_key_invalid_format"],
    [{ name: "x", apiKey: "a b" }, "openai", "api_key_invalid_format"],
    [
      { name: "x", apiKey: "a".repeat(513) },
      "openai",
      "api_key_invalid_format",
    ],
    [{ name: "x", testModel: "bad model" }, "openai", "test_model_invalid"],
    [{ name: "x", testModel: "a".repeat(201) }, "openai", "test_model_invalid"],
    [
      { name: "x", reasoningEffort: "bad effort" },
      "openai",
      "reasoning_effort_invalid",
    ],
  ] as const)("rejects invalid input with %s", (input, provider, code) => {
    expect(() => validateAgentInput(input, provider)).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});

describe("connection scopes", () => {
  it("normalizes and deduplicates targets while preserving kind", () => {
    expect(readAgentConnectionScope({ mode: "global" })).toEqual({
      mode: "global",
      targets: [],
    });
    expect(
      readAgentConnectionScope({
        mode: "restricted",
        targets: [
          { kind: "person", targetId: " user " },
          { kind: "person", targetId: "user" },
          { kind: "group", targetId: "user" },
        ],
      }),
    ).toEqual({
      mode: "restricted",
      targets: [
        { kind: "person", targetId: "user" },
        { kind: "group", targetId: "user" },
      ],
    });
  });

  it.each([
    null,
    { mode: "other" },
    { mode: "global", targets: [{ kind: "person", targetId: "a" }] },
    { mode: "restricted" },
    { mode: "restricted", targets: "person" },
    {
      mode: "restricted",
      targets: Array(201).fill({ kind: "person", targetId: "a" }),
    },
    { mode: "restricted", targets: [{ kind: "system", targetId: "a" }] },
    { mode: "restricted", targets: [{ kind: "person", targetId: "  " }] },
    {
      mode: "restricted",
      targets: [{ kind: "person", targetId: "a".repeat(101) }],
    },
    { mode: "restricted", targets: [{ kind: "person", targetId: "a\nb" }] },
  ])("rejects malformed scope %#", (scope) => {
    expect(() => readAgentConnectionScope(scope)).toThrowError(
      expect.objectContaining({ code: "connection_scope_invalid" }),
    );
  });
});
