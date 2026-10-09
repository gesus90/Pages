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

// Shapes follow `codex debug models` and `claude --help`; names are synthetic.
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
const CLAUDE_HELP = [
  "Usage: claude [options] [command] [prompt]",
  "",
  "Options:",
  "  --effort <level>                      Effort level for the current session",
  "                                        (low, medium, high, max)",
  "  --environment <environment_id>        Create a new cloud session",
  "  --model <model>                       Model for the current session. Provide",
  "                                        an alias for the latest model (e.g.",
  "                                        'opus', 'sonnet', or 'opus') or a",
  "                                        model's full name.",
  "  --print                               Print the response",
].join("\n");

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
      "a bracketed model ID",
      JSON.stringify({ models: [{ slug: "model[1m]", visibility: "list" }] }),
    ],
  ])("rejects Codex output with %s", (_, stdout) => {
    expect(() => readCodexModels(stdout)).toThrow(
      expect.objectContaining({ code: "cli_unexpected_output" }),
    );
  });

  it("reads Claude Code aliases once each, with the efforts its help names", () => {
    const models = readClaudeModels(CLAUDE_HELP);
    expect(models.map((model) => model.id)).toEqual(["opus", "sonnet"]);
    expect(models[0]).toMatchObject({
      name: "opus",
      reasoning: "levels",
      reasoningEfforts: ["low", "medium", "high", "max"],
      defaultReasoningEffort: null,
    });
  });

  it.each([
    ["without effort levels", CLAUDE_HELP.replace("--effort", "--effortless")],
    ["without model aliases", CLAUDE_HELP.replace(/'[a-z]+'/g, "x")],
    ["with an empty effort list", CLAUDE_HELP.replace(/\(low.*max\)/, "()")],
  ])("rejects Claude Code help %s", (_, help) => {
    expect(() => readClaudeModels(help)).toThrow(
      expect.objectContaining({ code: "cli_unexpected_output" }),
    );
  });

  it.each([
    ["codex_cli", CODEX_MODELS, ["debug", "models"], "vendor-large"],
    ["claude_code", CLAUDE_HELP, ["--help"], "opus"],
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
        "ignore",
        "pipe",
        "pipe",
      ]);
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
