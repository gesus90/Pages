import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliTextExecution } from "@/backend/agents/cli/CliTextExecution";
import { readCliTextResponse } from "@/backend/agents/cli/CliTextResponse";

import { CLI_HOME, completeCli, createCliSpawn } from "../helpers/agent-cli";

import type { CliToolAdapter } from "@/backend/agents/cli/CliContracts";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { CliProviderId } from "@/definition/AgentConnection";

const CODEX_OUTPUT = [
  {
    type: "item.completed",
    item: { type: "agent_message", text: "Text response" },
  },
  { type: "turn.completed", usage: { output_tokens: 3 } },
]
  .map((entry) => JSON.stringify(entry))
  .join("\n");
const CLAUDE_OUTPUT = JSON.stringify({
  is_error: false,
  subtype: "success",
  result: "Text response",
});

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-text-cli-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function setup(
  provider: CliProviderId = "codex_cli",
  effort: string | null = null,
) {
  const store = new AgentCredentialStore(directory);
  const locator = new CliLocator("/synthetic/not-installed", "/synthetic/node");
  vi.spyOn(locator, "find").mockResolvedValue({
    found: true,
    path: "/synthetic/binary",
  });
  const fake = createCliSpawn();
  const runner = new CliProcessRunner(fake);
  const runtime = new AgentCliRuntime({ store, locator, runner });
  const adapter: CliToolAdapter = {
    provider,
    readStatus: vi.fn().mockResolvedValue({
      outcome: { ok: true, detail: {} },
      accountLabel: null,
    }),
    version: vi.fn(),
    startLogin: vi.fn(),
    loginError: vi.fn(),
    runTest: vi.fn(),
    listModels: vi.fn(),
    logout: vi.fn(),
  };
  vi.spyOn(runtime, "adapter").mockResolvedValue(adapter);
  const input: TextExecutionInput = {
    prompt: "Only the selected passage",
    agent: {
      model: "listed-model",
      reasoningEffort: effort,
      connection: {
        id: path.basename(CLI_HOME.root),
        name: "CLI",
        provider,
        hasApiKey: false,
        testModel: "diagnostic-default",
        reasoningEffort: null,
        cliLoggedInAt: "2026-10-09T12:00:00Z",
        cliAccountLabel: null,
        updatedAt: "now",
      },
    },
  };
  const execution = new CliTextExecution({ store, locator, runner, runtime });
  return {
    execution,
    input,
    fake,
    runner,
    store,
    locator,
    adapter,
    signal: new AbortController().signal,
  };
}

describe.each(["codex_cli", "claude_code"] as const)(
  "%s text execution",
  (provider) => {
    it.each([null, "medium"])(
      "pins the selected model/effort %s and sends text on closed stdin without tools",
      async (effort) => {
        const { execution, input, fake, signal } = setup(provider, effort);
        const pending = execution.run(input, signal);
        await vi.waitFor(() => expect(fake.children).toHaveLength(1));
        const child = fake.children[0];
        expect(child.stdin).toBeInstanceOf(PassThrough);
        if (child.stdin instanceof PassThrough)
          expect(child.stdin.read().toString()).toBe(input.prompt);
        expect(child.stdin?.writableEnded).toBe(true);
        const [, args, options] = fake.spawn.mock.calls[0];
        expect(args).toContain("listed-model");
        expect(args).not.toContain(input.prompt);
        expect(args).not.toContain("diagnostic-default");
        expect(options).toMatchObject({ shell: false, detached: true });
        expect(options.env?.HOME).toContain(directory);
        if (provider === "codex_cli") {
          expect(args).toContain("features.shell_tool=false");
          expect(args).toContain("mcp_servers={}");
          expect(args).toContain("--ephemeral");
          expect(args).toContain("--ignore-user-config");
        } else {
          expect(args).toContain("--no-session-persistence");
          expect(args).toContain("--tools");
          expect(args).toContain("--safe-mode");
        }
        completeCli(
          child,
          provider === "codex_cli" ? CODEX_OUTPUT : CLAUDE_OUTPUT,
        );
        expect(await pending).toBe("Text response");
      },
    );
  },
);

describe("CLI failure boundaries", () => {
  it("rejects wrong provider, missing login/binary and failed processes while securing credential files", async () => {
    const harness = setup();
    await expect(
      harness.execution.run(
        {
          ...harness.input,
          agent: {
            ...harness.input.agent,
            connection: {
              ...harness.input.agent.connection,
              provider: "openai",
            },
          },
        },
        harness.signal,
      ),
    ).rejects.toThrow("connectionUnavailable");
    vi.mocked(harness.adapter.readStatus).mockResolvedValueOnce({
      outcome: { ok: false, errorCode: "cli_not_logged_in", detail: {} },
      accountLabel: null,
    });
    await expect(
      harness.execution.run(harness.input, harness.signal),
    ).rejects.toThrow("connectionUnavailable");
    vi.mocked(harness.locator.find).mockResolvedValueOnce({
      found: false,
      path: null,
    });
    await expect(
      harness.execution.run(harness.input, harness.signal),
    ).rejects.toThrow("connectionUnavailable");
    const secure = vi.spyOn(harness.store, "secure");
    for (const result of [
      {
        exitCode: 1,
        stdout: "credential diagnostic",
        stderr: "",
        errorCode: null,
      },
      {
        exitCode: 0,
        stdout: CODEX_OUTPUT,
        stderr: "",
        errorCode: "check_timeout" as const,
      },
    ]) {
      vi.spyOn(harness.runner, "run").mockResolvedValueOnce(result);
      await expect(
        harness.execution.run(harness.input, harness.signal),
      ).rejects.toThrow("providerFailed");
    }
    expect(secure).toHaveBeenCalledTimes(2);
  });

  it("handles stdin input on a fake process with no writable pipe", async () => {
    const fake = createCliSpawn();
    const runner = new CliProcessRunner(fake);
    const pending = runner.run({
      file: "/synthetic/codex",
      arguments: [],
      provider: "codex_cli",
      home: CLI_HOME,
      timeoutMs: 1000,
      stdin: "ignore",
      input: "Synthetic input",
    });
    completeCli(fake.children[0]);
    expect((await pending).exitCode).toBe(0);
  });

  it("requires completed text and rejects errors, tools, malformed JSON and failed Claude results", () => {
    expect(
      readCliTextResponse(
        "codex_cli",
        "\n" +
          JSON.stringify({
            type: "item.started",
            item: { type: "reasoning" },
          }) +
          "\n" +
          JSON.stringify({
            type: "item.started",
            item: { type: "agent_message" },
          }) +
          "\n" +
          CODEX_OUTPUT,
      ),
    ).toBe("Text response");
    for (const output of [
      "bad",
      "",
      JSON.stringify({ type: "turn.completed" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "partial" },
      }),
      JSON.stringify({ type: "turn.failed" }),
      JSON.stringify({ type: "error" }),
      JSON.stringify({
        type: "item.started",
        item: { type: "command_execution" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: 1 },
      }),
      JSON.stringify({ type: "item.completed", item: { type: "reasoning" } }),
    ]) {
      expect(() => readCliTextResponse("codex_cli", output)).toThrow();
    }
    for (const output of [
      "bad",
      JSON.stringify({ is_error: true }),
      JSON.stringify({ is_error: false, subtype: "error" }),
      JSON.stringify({ is_error: false, subtype: "success", result: 1 }),
    ]) {
      expect(() => readCliTextResponse("claude_code", output)).toThrow(
        "invalidOutput",
      );
    }
  });
});
