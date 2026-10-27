import { describe, expect, it } from "vitest";

import {
  describeClaudeModel,
  findSavedModel,
  findStoredModel,
  isClaudeModelAlias,
  parseClaudeModelId,
  resolveClaudeModelAlias,
} from "@/definition/AgentModelVersion";

describe("parsing a Claude model id", () => {
  it.each([
    {
      id: "claude-sonnet-4",
      parts: { family: "sonnet", version: "4", context: null },
    },
    {
      id: "claude-opus-4-5",
      parts: { family: "opus", version: "4.5", context: null },
    },
    {
      id: "claude-haiku-4-5-20251001",
      parts: { family: "haiku", version: "4.5", context: null },
    },
    {
      id: "claude-sonnet-4-5[1m]",
      parts: { family: "sonnet", version: "4.5", context: "1m" },
    },
    {
      id: "CLAUDE-Sonnet-5[1M]",
      parts: { family: "sonnet", version: "5", context: "1m" },
    },
  ])("reads $id", ({ id, parts }) => {
    expect(parseClaudeModelId(id)).toEqual(parts);
  });

  it.each([
    "gpt-5",
    "claude-sonnet",
    "claude-4",
    "claude-sonnet-4-5-6",
    "sonnet",
  ])("refuses %s", (id) => {
    expect(parseClaudeModelId(id)).toBeNull();
  });

  it("recognizes a family alias with an optional context size", () => {
    expect(isClaudeModelAlias("sonnet")).toBe(true);
    expect(isClaudeModelAlias("opus[1m]")).toBe(true);
    expect(isClaudeModelAlias("claude-sonnet-4")).toBe(false);
    expect(isClaudeModelAlias("")).toBe(false);
  });
});

describe("describing a Claude model", () => {
  it("names the family and the version when the name carries no version", () => {
    expect(describeClaudeModel("claude-sonnet-4-5", "Sonnet")).toBe(
      "Sonnet 4.5",
    );
    expect(describeClaudeModel("claude-opus-4", "Opus (preview)")).toBe(
      "Opus 4 (preview)",
    );
  });

  it("adds the context size unless the name already states one", () => {
    expect(describeClaudeModel("claude-sonnet-4-5[1m]", "Sonnet")).toBe(
      "Sonnet 4.5 (1M)",
    );
    expect(
      describeClaudeModel("claude-sonnet-4-5[1m]", "Sonnet (1M context)"),
    ).toBe("Sonnet 4.5 (1M context)");
  });

  it("describes a name with unbalanced parentheses by the whole name", () => {
    expect(describeClaudeModel("claude-sonnet-4", "Sonnet (preview")).toBe(
      "Sonnet 4",
    );
  });

  it("keeps a name that already shows a version and any name of another provider", () => {
    expect(describeClaudeModel("claude-sonnet-4-5", "Sonnet 4.5")).toBe(
      "Sonnet 4.5",
    );
    expect(describeClaudeModel("gpt-5", "GPT")).toBe("GPT");
  });
});

describe("resolving a family alias", () => {
  const models = [
    { id: "claude-sonnet-4-5" },
    { id: "claude-sonnet-4-5[1m]" },
    { id: "claude-opus-4" },
    { id: "claude-opus-4-1" },
  ];

  it("resolves the only model of a family and context", () => {
    expect(resolveClaudeModelAlias("sonnet", models)).toBe("claude-sonnet-4-5");
    expect(resolveClaudeModelAlias("SONNET[1M]", models)).toBe(
      "claude-sonnet-4-5[1m]",
    );
  });

  it("answers nothing for an ambiguous or unknown family, the default alias or a non-alias", () => {
    expect(resolveClaudeModelAlias("opus", models)).toBeNull();
    expect(resolveClaudeModelAlias("haiku", models)).toBeNull();
    expect(resolveClaudeModelAlias("default", models)).toBeNull();
    expect(resolveClaudeModelAlias("Default", models)).toBeNull();
    expect(resolveClaudeModelAlias("claude-sonnet-4-5", models)).toBeNull();
  });

  it("trusts the aliases a catalog states and needs exactly one model for them", () => {
    const catalog = [
      { id: "m1", aliases: ["fast"] },
      { id: "m2", aliases: ["fast", "smart"] },
      { id: "m3" },
    ];

    expect(resolveClaudeModelAlias("smart", catalog)).toBe("m2");
    expect(resolveClaudeModelAlias("fast", catalog)).toBeNull();
    expect(resolveClaudeModelAlias("slow", catalog)).toBeNull();
  });
});

describe("finding a stored model", () => {
  const models = [
    { model: "claude-sonnet-4-5", connectionId: "c1" },
    { model: "claude-opus-4-1", connectionId: "c1" },
    { model: "claude-sonnet-4-5", connectionId: "c2" },
  ];

  it("prefers the exact model and reports no alias for it", () => {
    expect(findStoredModel(models, "claude-opus-4-1")).toEqual({
      model: models[1],
      alias: null,
    });
  });

  it("resolves a stored family alias and keeps it", () => {
    expect(findStoredModel(models.slice(0, 2), "opus")).toEqual({
      model: models[1],
      alias: "opus",
    });
  });

  it("finds nothing for a model that is gone or an alias that does not resolve", () => {
    expect(findStoredModel(models, "gpt-5")).toBeUndefined();
    expect(findStoredModel(models, "sonnet")).toBeUndefined();
  });

  it("looks a saved model up inside its own connection only", () => {
    expect(
      findSavedModel(models, { connectionId: "c2", model: "claude-sonnet-4-5" })
        ?.model,
    ).toBe(models[2]);
    expect(
      findSavedModel(models, { connectionId: "c2", model: "claude-opus-4-1" }),
    ).toBeUndefined();
    expect(
      findSavedModel(models, { model: "claude-sonnet-4-5" }),
    ).toBeUndefined();
  });
});
