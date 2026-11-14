import { describe, expect, it } from "vitest";

import {
  filterModelGroups,
  findModelChoice,
  modelGroups,
  modelToolLabel,
} from "@/app/components/agents/model-picker/model-catalog";
import { createI18n } from "@/app/lib/i18n";

import { pageModel } from "../plans/plan-model-fixture";

import type { ModelGroup } from "@/app/components/agents/model-picker/model-catalog";
import type { PageAgentModel } from "@/definition/PageAgent";

const translate = createI18n("en").t;

const REMOTE_ROUTE = {
  connectionId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  catalogRevision: "1",
} as const;

function groupsOf(
  models: readonly PageAgentModel[],
  options: {
    refusalOf?: (model: PageAgentModel) => string | null;
    selectedId?: string;
  } = {},
): readonly ModelGroup[] {
  return modelGroups(models, { translate, ...options });
}

function labelsOf(group: ModelGroup): string[] {
  return group.sources.flatMap((source) =>
    source.choices.map((choice) => choice.label),
  );
}

describe("modelToolLabel", () => {
  it("names a registered tool by its short name", () => {
    expect(modelToolLabel("codex_cli", translate)).toBe("Codex");
  });

  it("falls back to the registered connection name for a provider without a short name", () => {
    expect(modelToolLabel("openai", translate)).toBe("OpenAI API");
  });
});

describe("modelGroups ordering and filtering", () => {
  it("lists the fixed tool order first and unknown tools by name afterwards", () => {
    const groups = groupsOf([
      pageModel("a", { provider: "anthropic", connectionName: "Anthropic" }),
      pageModel("b", { provider: "zai" }),
      pageModel("c", { provider: "claude_code" }),
      pageModel("d", { provider: "openrouter" }),
      pageModel("e", { provider: "google_ai_studio" }),
      pageModel("f", { provider: "openai" }),
      pageModel("g", { provider: "codex_cli" }),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "claude_code",
      "codex_cli",
      "openrouter",
      "zai",
      "anthropic",
      "google_ai_studio",
      "openai",
    ]);
    expect(groups[0].mark).toBe("claude");
  });

  it("keeps models the catalog rules out for chatting for the consumer to refuse", () => {
    const groups = groupsOf([
      pageModel("chat", { provider: "claude_code" }),
      pageModel("silent", { provider: "claude_code", isChatCapable: false }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(findModelChoice(groups, "silent")?.choice.model.id).toBe("silent");
  });

  it("keeps one entry per selection key", () => {
    const groups = groupsOf([
      pageModel("same", { provider: "claude_code", modelName: "First" }),
      pageModel("same", { provider: "claude_code", modelName: "Second" }),
    ]);

    expect(labelsOf(groups[0])).toEqual(["Second"]);
  });

  it("sorts models by name with numbers in numeric order", () => {
    const groups = groupsOf([
      pageModel("m10", { provider: "claude_code", modelName: "Model 10" }),
      pageModel("m2", { provider: "claude_code", modelName: "Model 2" }),
    ]);

    expect(labelsOf(groups[0])).toEqual(["Model 2", "Model 10"]);
  });
});

describe("modelGroups naming of models", () => {
  it("drops a trailing Free from the label and marks the model free", () => {
    const [group] = groupsOf([
      pageModel("flash", {
        provider: "claude_code",
        modelName: "GLM-5.3-Flash Free",
        isFree: true,
      }),
      pageModel("plain", {
        provider: "claude_code",
        modelName: "Model (free)",
      }),
      pageModel("only", { provider: "claude_code", modelName: "Free" }),
    ]);
    const choices = group.sources[0].choices;

    expect(choices.map((choice) => choice.label)).toEqual([
      "Free",
      "GLM-5.3-Flash",
      "Model",
    ]);
    expect(choices.map((choice) => choice.isFree)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("keeps the whole name when removing a trailing Free would leave nothing", () => {
    const [group] = groupsOf([
      pageModel("bare", { provider: "claude_code", modelName: "(free)" }),
    ]);

    expect(group.sources[0].choices[0].label).toBe("(free)");
  });

  it("uses the model name when no catalog name exists", () => {
    const [group] = groupsOf([
      pageModel("legacy", { provider: "claude_code", name: "Legacy name" }),
    ]);

    expect(group.sources[0].choices[0].label).toBe("Legacy name");
  });

  it("shows the technical ID only where two models of a source share a name", () => {
    const [group] = groupsOf([
      pageModel("one", { provider: "claude_code", modelName: "Twin" }),
      pageModel("two", { provider: "claude_code", modelName: "Twin" }),
      pageModel("three", { provider: "claude_code", modelName: "Solo" }),
    ]);

    expect(
      group.sources[0].choices.map((choice) => [choice.label, choice.detail]),
    ).toEqual([
      ["Solo", null],
      ["Twin", "vendor/one"],
      ["Twin", "vendor/two"],
    ]);
  });

  it("carries the refusal of the place and keeps the row listed", () => {
    const [group] = groupsOf([pageModel("a", { provider: "claude_code" })], {
      refusalOf: () => "Runs elsewhere",
    });

    expect(group.sources[0].choices[0].refusal).toBe("Runs elsewhere");
  });

  it("builds lower-case search text from name, ID, tool, access, connection, target and free", () => {
    const [group] = groupsOf([
      pageModel("a", {
        provider: "claude_code",
        modelName: "Sonnet",
        connectionName: "Team Account",
        isFree: true,
      }),
    ]);
    const text = group.sources[0].choices[0].searchText;

    for (const word of [
      "sonnet",
      "vendor/a",
      "claude code",
      "claude subscription",
      "team account",
      "free",
    ])
      expect(text).toContain(word);
    expect(text).toBe(text.toLowerCase());
  });
});

describe("modelGroups sources and access", () => {
  it("names the access of a tool with one connection by the tool's access kind", () => {
    const [group] = groupsOf([
      pageModel("a", { provider: "anthropic", connectionName: "Main key" }),
    ]);

    expect(group.context).toBe("API key");
    expect(group.sources[0].label).toBeNull();
    expect(group.sources[0].choices[0].source).toBeNull();
  });

  it("counts the accesses of a tool with several connections and badges each source", () => {
    const [group] = groupsOf([
      pageModel("a", {
        provider: "anthropic",
        connectionId: "c1",
        connectionName: "Zeta",
      }),
      pageModel("b", {
        provider: "anthropic",
        connectionId: "c2",
        connectionName: "Alpha",
      }),
    ]);

    expect(group.context).toBe("2 accesses");
    expect(group.sources.map((source) => source.label)).toEqual([
      "Alpha",
      "Zeta",
    ]);
    expect(group.sources[0].choices[0].source).toBe("Alpha");
  });

  it("falls back to an empty source key for a model without any connection", () => {
    const [group] = groupsOf([
      pageModel("a", {
        provider: "anthropic",
        connectionId: undefined,
        connectionName: undefined,
      }),
    ]);

    expect(group.sources[0].key).toBe("");
  });

  it("names the free access of OpenCode when every model is free", () => {
    const [group] = groupsOf([
      pageModel("a", {
        provider: "opencode",
        model: "opencode/big-pickle",
        isFree: true,
      }),
    ]);

    expect(group.key).toBe("opencode");
    expect(group.context).toBe("Free models");
    expect(group.sources[0].key).toBe("opencode");
    expect(group.sources[0].label).toBeNull();
  });

  it("names the OpenCode key when a paid model is listed from one source", () => {
    const [group] = groupsOf([
      pageModel("a", {
        provider: "opencode",
        model: "opencode/big-pickle",
        isFree: true,
      }),
      pageModel("b", { provider: "opencode", model: "opencode/paid" }),
    ]);

    expect(group.context).toBe("OpenCode key");
  });

  it("lists OpenCode's own provider first and joins the source names", () => {
    const [group] = groupsOf([
      pageModel("g", {
        provider: "opencode",
        model: "anthropic/sonnet",
        modelName: "Sonnet",
      }),
      pageModel("o", {
        provider: "opencode",
        model: "opencode/big-pickle",
        modelName: "Big Pickle",
      }),
      pageModel("a", {
        provider: "opencode",
        model: "aaa/other",
        modelName: "Other",
      }),
    ]);

    expect(group.sources.map((source) => source.label)).toEqual([
      "OpenCode",
      "aaa",
      "anthropic",
    ]);
    expect(group.context).toBe("OpenCode + aaa + anthropic");
    expect(group.sources[1].choices[0].source).toBe("aaa");
  });
});

describe("modelGroups provider boundaries", () => {
  it("retains direct API and OpenCode access to the same model under their providers", () => {
    const models = [
      pageModel("direct", { provider: "openrouter", model: "vendor/thing" }),
      pageModel("via", {
        provider: "opencode",
        model: "openrouter/vendor/thing",
      }),
      pageModel("zai", { provider: "opencode", model: "zai-coding-plan/glm" }),
    ];
    const groups = groupsOf(models, {
      refusalOf: (model) => (model.id === "direct" ? "No chat adapter" : null),
      selectedId: "direct",
    });
    expect(groups.map((group) => group.key)).toEqual([
      "opencode",
      "openrouter",
    ]);
    expect(findModelChoice(groups, "direct")?.choice.refusal).toBe(
      "No chat adapter",
    );
    expect(findModelChoice(groups, "via")?.group.key).toBe("opencode");
    expect(findModelChoice(groups, "zai")?.group.key).toBe("opencode");
    expect(groupsOf(models).map((group) => group.key)).toEqual(
      groups.map((group) => group.key),
    );
  });

  it("keeps each connection's selection key even for identical upstream IDs", () => {
    const [group] = groupsOf([
      pageModel("first", { provider: "openrouter", model: "vendor/thing" }),
      pageModel("second", { provider: "openrouter", model: "vendor/thing" }),
    ]);
    expect(
      group.sources.flatMap((source) =>
        source.choices.map((choice) => choice.model.id),
      ),
    ).toEqual(["first", "second"]);
  });
});

describe("modelGroups execution targets and simulation", () => {
  it("lists this host first and a remote target in a group of its own", () => {
    const groups = groupsOf([
      pageModel("remote", {
        provider: "claude_code",
        runnerRoute: REMOTE_ROUTE,
        targetName: "Build box",
      }),
      pageModel("local", { provider: "claude_code" }),
      pageModel("remote-codex", {
        provider: "codex_cli",
        runnerRoute: REMOTE_ROUTE,
        targetName: "Build box",
      }),
      pageModel("nameless", {
        provider: "codex_cli",
        runnerRoute: { ...REMOTE_ROUTE, workspaceId: "other-workspace" },
      }),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "claude_code",
      `${REMOTE_ROUTE.workspaceId}:claude_code`,
      `${REMOTE_ROUTE.workspaceId}:codex_cli`,
      "other-workspace:codex_cli",
    ]);
    expect(groups[1].context).toBe("Build box · Claude subscription");
    expect(groups[3].context).toContain("other-workspace · ");
  });

  it("matches OpenCode models of a remote target by the target's name", () => {
    const [group] = groupsOf([
      pageModel("r", {
        provider: "opencode",
        model: "opencode/big-pickle",
        runnerRoute: REMOTE_ROUTE,
        targetName: "Build box",
      }),
    ]);

    expect(group.sources[0].choices[0].searchText).toContain("build box");
  });

  it("collects simulation models last in a group named Simulation", () => {
    const groups = groupsOf([
      pageModel("sim", {
        provider: "claude_code",
        isSimulation: true,
        modelName: "Fake",
      }),
      pageModel("real", { provider: "claude_code" }),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "claude_code",
      "simulation",
    ]);
    const simulation = groups[1];
    expect(simulation.label).toBe("Simulation");
    expect(simulation.context).toBe("Development · no model provider");
    expect(simulation.mark).toBe("simulation");
    expect(simulation.count).toBe(1);
    expect(labelsOf(simulation)).toEqual(["Fake"]);
  });

  it("returns no groups for an empty catalog", () => {
    expect(groupsOf([])).toEqual([]);
  });
});

describe("filterModelGroups", () => {
  const groups = groupsOf([
    pageModel("a", { provider: "claude_code", modelName: "Sonnet" }),
    pageModel("b", { provider: "claude_code", modelName: "Haiku" }),
    pageModel("c", { provider: "codex_cli", modelName: "GPT Sonnet" }),
    pageModel("d", {
      provider: "anthropic",
      modelName: "Opus",
      connectionId: "c1",
      connectionName: "Main",
    }),
    pageModel("e", {
      provider: "anthropic",
      modelName: "Opus Two",
      connectionId: "c2",
      connectionName: "Backup",
    }),
  ]);

  it("returns every group for a blank query", () => {
    expect(filterModelGroups(groups, "")).toBe(groups);
    expect(filterModelGroups(groups, "   ")).toBe(groups);
  });

  it("keeps only matching models, counts the matches and drops empty groups", () => {
    const filtered = filterModelGroups(groups, "SONNET");

    expect(filtered.map((group) => group.key)).toEqual([
      "claude_code",
      "codex_cli",
    ]);
    expect(filtered[0].count).toBe(1);
    expect(labelsOf(filtered[0])).toEqual(["Sonnet"]);
  });

  it("requires every word to match, in any order", () => {
    expect(
      filterModelGroups(groups, "claude   sonnet").map((group) => group.key),
    ).toEqual(["claude_code"]);
    expect(filterModelGroups(groups, "sonnet claude haiku")).toEqual([]);
  });

  it("drops a source without a match but keeps the sources that match", () => {
    const [group] = filterModelGroups(groups, "backup");

    expect(group.sources.map((source) => source.label)).toEqual(["Backup"]);
    expect(group.count).toBe(1);
  });
});

describe("findModelChoice", () => {
  const groups = groupsOf([
    pageModel("a", { provider: "claude_code" }),
    pageModel("b", { provider: "codex_cli" }),
  ]);

  it("finds a model with its group", () => {
    const found = findModelChoice(groups, "b");

    expect(found?.group.key).toBe("codex_cli");
    expect(found?.choice.model.id).toBe("b");
  });

  it("returns null for an unlisted model", () => {
    expect(findModelChoice(groups, "missing")).toBeNull();
  });
});

it("uses a connection name as its source key when its ID is absent", () => {
  const [group] = groupsOf([
    pageModel("named", {
      provider: "anthropic",
      connectionId: undefined,
      connectionName: "Team",
    }),
  ]);

  expect(group.sources[0].key).toBe("Team");
  expect(group.sources[0].choices[0].model.id).toBe("named");
});

it("sorts identical display names by their technical model IDs", () => {
  const [group] = groupsOf([
    pageModel("z", {
      provider: "claude_code",
      modelName: "Twin",
      model: "vendor/z",
    }),
    pageModel("a", {
      provider: "claude_code",
      modelName: "Twin",
      model: "vendor/a",
    }),
  ]);

  expect(group.sources[0].choices.map((choice) => choice.detail)).toEqual([
    "vendor/a",
    "vendor/z",
  ]);
});
