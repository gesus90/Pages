import { describe, expect, it } from "vitest";

import {
  matchAgentChatModels,
  parseAgentChatCommand,
  readAgentChatEffort,
  shortModelName,
} from "@/definition/AgentChatControl";

import type { AgentChatModelChoice } from "@/definition/AgentChatControl";

function choice(
  fields: Partial<AgentChatModelChoice> & Pick<AgentChatModelChoice, "model">,
): AgentChatModelChoice {
  return {
    connectionId: "anthropic",
    name: fields.model,
    connectionName: "Anthropic",
    provider: "anthropic",
    reasoningEfforts: ["low", "medium", "high", "max"],
    defaultReasoningEffort: "medium",
    contextWindow: 200_000,
    aliases: [],
    ...fields,
  };
}

const CHOICES = [
  choice({
    model: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    aliases: ["opus"],
  }),
  choice({
    model: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    aliases: ["sonnet"],
  }),
  choice({
    connectionId: "openrouter",
    connectionName: "OpenRouter",
    provider: "openrouter",
    model: "openai/gpt-5.5-opus-preview",
    name: "GPT-5.5 Opus Preview",
  }),
];

describe("parseAgentChatCommand (PAGE-380)", () => {
  it("splits a group command into command, mention and words", () => {
    expect(parseAgentChatCommand("/model @Ed opus hoch")).toEqual({
      command: "model",
      mention: "Ed",
      words: ["opus", "hoch"],
    });
    expect(parseAgentChatCommand("  /NEW @mei ")).toEqual({
      command: "new",
      mention: "mei",
      words: [],
    });
  });

  it("reads a direct command without mention and leaves any other text a message", () => {
    expect(parseAgentChatCommand("/compact")).toEqual({
      command: "compact",
      mention: null,
      words: [],
    });
    expect(parseAgentChatCommand("/model reset")).toEqual({
      command: "model",
      mention: null,
      words: ["reset"],
    });
    expect(parseAgentChatCommand("Bitte /new machen")).toBeNull();
    expect(parseAgentChatCommand("/newsletter")).toBeNull();
    expect(parseAgentChatCommand("/sessions")).toBeNull();
  });
});

describe("matchAgentChatModels (PAGE-380)", () => {
  it("prefers an exact alias, name or ID over a partial match", () => {
    // "opus" is the alias of Claude Opus and part of the OpenRouter model; the alias wins.
    expect(
      matchAgentChatModels("opus", CHOICES).map((entry) => entry.model),
    ).toEqual(["claude-opus-5-5"]);
    expect(
      matchAgentChatModels("Claude Sonnet 5.5", CHOICES).map(
        (entry) => entry.model,
      ),
    ).toEqual(["claude-sonnet-5-5"]);
  });

  it("lists every model of an ambiguous short name instead of guessing", () => {
    const matches = matchAgentChatModels("5.5", CHOICES);
    expect(matches).toHaveLength(3);
    expect(matchAgentChatModels("gemini", CHOICES)).toEqual([]);
  });
});

describe("readAgentChatEffort (PAGE-380)", () => {
  it("reads German and English level words among the levels of the model", () => {
    const efforts = ["low", "medium", "high", "max"];
    expect(readAgentChatEffort("hoch", efforts)).toBe("high");
    expect(readAgentChatEffort("Mittel", efforts)).toBe("medium");
    expect(readAgentChatEffort("max", efforts)).toBe("max");
    expect(readAgentChatEffort("xhigh", efforts)).toBeNull();
    expect(readAgentChatEffort("hoch", [])).toBeNull();
  });
});

describe("shortModelName (PAGE-380)", () => {
  it("names a model by its distinctive word for the head of the chat", () => {
    expect(shortModelName("Claude Opus 5.5")).toBe("Opus");
    expect(shortModelName("Gemini 3.5 Pro")).toBe("Pro");
    expect(shortModelName("GPT-5.5")).toBe("GPT-5.5");
  });
});
