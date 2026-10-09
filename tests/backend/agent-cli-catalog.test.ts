import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { ClaudeCodeCli } from "@/backend/agents/cli/ClaudeCodeCli";
import { CodexCli } from "@/backend/agents/cli/CodexCli";
import {
  readClaudeModels,
  readCodexModels,
} from "@/backend/agents/cli/CliModelCatalog";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliToolExecution } from "@/backend/agents/cli/CliToolExecution";

import { CLI_HOME, completeCli, createCliSpawn } from "../helpers/agent-cli";

import type { CliProviderId } from "@/definition/AgentConnection";

// Shapes follow `codex debug models` and Claude SDK initialization; names are synthetic.
const CODEX_MODELS = JSON.stringify({
  models: [
    {
      slug: "vendor-unranked",
      visibility: "list",
    },
    {
      slug: "vendor-large",
      display_name: "Vendor Large",
      visibility: "list",
      priority: 3,
      context_window: 272000,
      default_reasoning_level: "medium",
      supported_reasoning_levels: [
        { effort: "low", description: "Fast" },
        { effort: "medium", description: "Balanced" },
        { effort: "high", description: "Deep" },
      ],
    },
    {
      slug: "vendor-small",
      display_name: "Line\nbreak",
      visibility: "list",
      priority: 5,
      context_window: -1,
    },
    { slug: "internal-review", visibility: "hide", priority: 1 },
  ],
});
function claudeCatalog(models: readonly unknown[]) {
  return JSON.stringify({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: "pages-model-catalog",
      response: { models },
    },
  });
}
const CLAUDE_MODELS = claudeCatalog([
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5-5",
    displayName: "Sonnet",
    supportsEffort: true,
    supportedEffortLevels: ["low", "high"],
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-5-5",
    displayName: "Haiku",
    supportsEffort: false,
    supportedEffortLevels: ["high"],
  },
  {
    value: "fable",
    resolvedModel: "claude-fable-5-1",
    displayName: "Fable",
    supportsEffort: true,
    supportedEffortLevels: ["medium", "max"],
  },
  { value: "versioned-1", displayName: "Invalid\nname" },
  { value: "versioned-2", supportsEffort: true, supportedEffortLevels: [] },
]);

function adapterFor(provider: CliProviderId) {
  const fake = createCliSpawn();
  const execution = new CliToolExecution(
    new CliProcessRunner(fake),
    "/fake/cli",
    provider,
  );
  return {
    fake,
    adapter:
      provider === "codex_cli"
        ? new CodexCli(execution)
        : new ClaudeCodeCli(execution),
  };
}

describe("CLI model catalogs", () => {
  it("reads the listed Codex models in their priority order with their own reasoning levels", () => {
    expect(readCodexModels(CODEX_MODELS)).toEqual([
      {
        id: "vendor-large",
        name: "Vendor Large",
        contextWindow: 272000,
        promptPrice: null,
        completionPrice: null,
        isFree: false,
        reasoning: "levels",
        reasoningEfforts: ["low", "medium", "high"],
        defaultReasoningEffort: "medium",
      },
      {
        id: "vendor-small",
        name: "vendor-small",
        contextWindow: null,
        promptPrice: null,
        completionPrice: null,
        isFree: false,
        reasoning: "none",
        reasoningEfforts: [],
        defaultReasoningEffort: null,
      },
      expect.objectContaining({ id: "vendor-unranked" }),
    ]);
  });

  it.each([
    ["no JSON", "Logged out"],
    ["no model list", JSON.stringify({ models: {} })],
    [
      "too many entries",
      JSON.stringify({ models: Array.from({ length: 1001 }, () => ({})) }),
    ],
    [
      "only hidden models",
      JSON.stringify({ models: [{ slug: "internal", visibility: "hide" }] }),
    ],
    [
      "an unsafe model ID",
      JSON.stringify({ models: [{ slug: "two words", visibility: "list" }] }),
    ],
    [
      "a malformed bracket suffix",
      JSON.stringify({ models: [{ slug: "model[1m]x", visibility: "list" }] }),
    ],
  ])("rejects Codex output with %s", (_, stdout) => {
    expect(() => readCodexModels(stdout)).toThrow(
      expect.objectContaining({ code: "cli_unexpected_output" }),
    );
  });

  it("reads canonical Claude IDs and each model's own levels without help aliases or global efforts", () => {
    const models = readClaudeModels(
      `${JSON.stringify({ type: "system" })}\n${CLAUDE_MODELS}\n`,
    );
    expect(
      models.map((model) => [
        model.id,
        model.reasoning,
        model.reasoningEfforts,
      ]),
    ).toEqual([
      ["claude-sonnet-5-5", "levels", ["low", "high"]],
      ["claude-haiku-5-5", "none", []],
      ["claude-fable-5-1", "levels", ["medium", "max"]],
      ["versioned-1", "unknown", []],
      ["versioned-2", "unknown", []],
    ]);
    expect(models[0]?.name).toBe("Sonnet");
    expect(models[3]?.name).toBe("versioned-1");
    expect(
      readClaudeModels(claudeCatalog([{ value: "one" }, { value: "one" }])),
    ).toHaveLength(1);
  });

  it("keeps every enabled picker row as its own version, including 1M-context variants", () => {
    // Shape of Claude Code's subscriber picker: alias rows name the family,
    // their resolved model names the version; earlier versions are their own rows.
    const models = readClaudeModels(
      claudeCatalog([
        {
          value: "default",
          resolvedModel: "claude-opus-5-5",
          displayName: "Default (recommended)",
          supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        },
        {
          value: "opus[1m]",
          resolvedModel: "claude-opus-5-5[1m]",
          displayName: "Opus (1M context)",
          supportedEffortLevels: ["low", "max"],
        },
        {
          value: "sonnet",
          resolvedModel: "claude-sonnet-5-5",
          displayName: "Sonnet",
        },
        {
          value: "haiku",
          resolvedModel: "claude-haiku-5-5",
          displayName: "Haiku",
        },
        {
          value: "claude-haiku-4-5",
          resolvedModel: "claude-haiku-4-5-20251001",
          displayName: "Haiku 4.5",
          supportsEffort: false,
        },
        { value: "claude-opus-4-8", displayName: "Opus 4.8" },
        {
          value: "opus",
          resolvedModel: "claude-opus-5-5",
          displayName: "Opus",
          supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        },
        {
          value: "claude-mythos-5-1",
          displayName: "Mythos 5.1",
          disabled: true,
        },
      ]),
    );
    expect(models.map((model) => [model.id, model.name])).toEqual([
      ["claude-opus-5-5", "Opus"],
      ["claude-opus-5-5[1m]", "Opus (1M context)"],
      ["claude-sonnet-5-5", "Sonnet"],
      ["claude-haiku-5-5", "Haiku"],
      ["claude-haiku-4-5-20251001", "Haiku 4.5"],
      ["claude-opus-4-8", "Opus 4.8"],
    ]);
    expect(models[1]?.reasoningEfforts).toEqual(["low", "max"]);
    expect(models[4]?.reasoning).toBe("none");
  });

  it.each([
    "not JSON",
    JSON.stringify({}),
    JSON.stringify({
      type: "control_response",
      response: { subtype: "error", request_id: "pages-model-catalog" },
    }),
    JSON.stringify({
      type: "control_response",
      response: { subtype: "success", request_id: "other" },
    }),
    claudeCatalog([]),
    claudeCatalog([{ value: "opus", disabled: true }]),
    claudeCatalog(Array.from({ length: 1001 }, () => ({}))),
    claudeCatalog([{ value: "bad id" }]),
    claudeCatalog([{ value: 3 }]),
    claudeCatalog([{ value: "sonnet", resolvedModel: "bad id" }]),
    JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "pages-model-catalog",
        response: { models: {} },
      },
    }),
  ])(
    "rejects malformed or uncorrelated Claude catalog output: %s",
    (output) => {
      expect(() => readClaudeModels(output)).toThrow(
        expect.objectContaining({ code: "cli_unexpected_output" }),
      );
    },
  );

  it.each([
    ["codex_cli", CODEX_MODELS, ["debug", "models"], "vendor-large"],
    ["claude_code", CLAUDE_MODELS, ["--print"], "claude-sonnet-5-5"],
  ] as const)(
    "lists the %s catalog without a model turn and maps failures to safe codes",
    async (provider, output, command, first) => {
      const { fake, adapter } = adapterFor(provider);
      const signal = new AbortController().signal;
      const listed = adapter.listModels(CLI_HOME, signal);
      completeCli(fake.children[0], output);
      expect((await listed)[0]?.id).toBe(first);
      expect(fake.children[0].spawnargs.slice(0, command.length)).toEqual(
        command,
      );
      expect(fake.spawn.mock.calls[0]?.[2].stdio).toEqual([
        provider === "claude_code" ? "pipe" : "ignore",
        "pipe",
        "pipe",
      ]);
      if (provider === "claude_code") {
        const stdin = fake.children[0].stdin;
        expect(stdin).toBeInstanceOf(PassThrough);
        if (!(stdin instanceof PassThrough))
          throw new Error("Missing fake pipe");
        expect(stdin.read()?.toString()).toBe(
          `${JSON.stringify({ type: "control_request", request_id: "pages-model-catalog", request: { subtype: "initialize", hooks: {}, agents: {}, sdkMcpServers: [] } })}\n`,
        );
        expect(stdin?.writableEnded).toBe(true);
        expect(fake.children[0].spawnargs).toEqual(
          expect.arrayContaining([
            "stream-json",
            "--safe-mode",
            "--no-session-persistence",
          ]),
        );
        expect(fake.children[0].spawnargs).not.toContain("--model");
      }
      const failed = adapter.listModels(CLI_HOME, signal);
      completeCli(fake.children[1], output, 1);
      await expect(failed).rejects.toMatchObject({
        code: "cli_unexpected_output",
      });
      await expect(
        adapter.listModels(CLI_HOME, AbortSignal.abort()),
      ).rejects.toMatchObject({ code: "check_timeout" });
    },
  );

  it("passes Codex model listings above the usual output limit", async () => {
    const { fake, adapter } = adapterFor("codex_cli");
    const large = JSON.stringify({
      models: [
        ...JSON.parse(CODEX_MODELS).models,
        { slug: "padding", visibility: "hide", notes: "x".repeat(300_000) },
      ],
    });
    const listed = adapter.listModels(CLI_HOME, new AbortController().signal);
    completeCli(fake.children[0], large);
    expect(await listed).toHaveLength(3);
    expect(fake.children[0].spawnargs).toEqual(
      expect.arrayContaining([
        'cli_auth_credentials_store="file"',
        'forced_login_method="chatgpt"',
      ]),
    );
  });

  it("passes the saved model and effort to both CLI tests", async () => {
    const selection = { model: "vendor-large", reasoningEffort: "high" };
    const signal = new AbortController().signal;
    const codex = adapterFor("codex_cli");
    const codexTest = codex.adapter.runTest(CLI_HOME, selection, signal);
    completeCli(codex.fake.children[0], "", 1);
    await codexTest;
    expect(codex.fake.children[0].spawnargs).toEqual(
      expect.arrayContaining([
        "-m",
        "vendor-large",
        "-c",
        'model_reasoning_effort="high"',
      ]),
    );
    const claude = adapterFor("claude_code");
    const claudeTest = claude.adapter.runTest(CLI_HOME, selection, signal);
    completeCli(claude.fake.children[0], "", 1);
    await claudeTest;
    const args = claude.fake.children[0].spawnargs;
    expect(
      args.slice(args.indexOf("--model"), args.indexOf("--model") + 2),
    ).toEqual(["--model", "vendor-large"]);
    expect(
      args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 2),
    ).toEqual(["--effort", "high"]);
  });
});
