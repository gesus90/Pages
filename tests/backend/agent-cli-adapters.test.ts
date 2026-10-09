import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaudeCodeCli } from "@/backend/agents/cli/ClaudeCodeCli";
import { CodexCli } from "@/backend/agents/cli/CodexCli";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliToolExecution } from "@/backend/agents/cli/CliToolExecution";
import {
  readClaudeChallenge,
  readCodexChallenge,
} from "@/backend/agents/cli/CliLoginParser";
import {
  readClaudeTest,
  readCodexTest,
} from "@/backend/agents/cli/CliResultParser";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { CLI_HOME, completeCli, createCliSpawn } from "../helpers/agent-cli";

import type {
  CliModelSelection,
  CliProcessResult,
} from "@/backend/agents/cli/CliContracts";
import type { CliProviderId } from "@/definition/AgentConnection";

const SELECTED: CliModelSelection = {
  model: "test-model",
  reasoningEffort: "high",
};
const CLI_DEFAULTS: CliModelSelection = { model: null, reasoningEffort: null };
const CLAUDE_URL =
  "https://claude.com/cai/oauth/authorize?redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&code_challenge_method=S256&state=synthetic";
const CODEX_CHALLENGE =
  "Open this link https://auth.openai.com/codex/device\nEnter this one-time code\nABCD-EFGH\n";
const CODEX_SUCCESS =
  '{"type":"thread.started"}\n{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}\n';
const CLAUDE_SUCCESS = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  usage: { input_tokens: 12, output_tokens: 3 },
  total_cost_usd: 0.001,
  modelUsage: { "test-model": {} },
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(provider: CliProviderId) {
  const fake = createCliSpawn();
  const runner = new CliProcessRunner(fake);
  const execution = new CliToolExecution(runner, "/fake/cli", provider);
  const adapter =
    provider === "codex_cli"
      ? new CodexCli(execution)
      : new ClaudeCodeCli(execution);
  async function respond<Result>(
    operation: () => Promise<Result>,
    output: string,
    exitCode = 0,
    stderr = "",
  ): Promise<Result> {
    const pending = operation();
    const child = fake.children.at(-1);
    if (!child) throw new Error("no fake child");
    completeCli(child, output, exitCode, stderr);
    return pending;
  }
  return {
    ...fake,
    runner,
    execution,
    adapter,
    respond,
    signal: new AbortController().signal,
  };
}

describe("CLI output parsers", () => {
  it("extracts ANSI-wrapped device challenges only for the official OpenAI URL", () => {
    expect(readCodexChallenge(`\u001b[32m${CODEX_CHALLENGE}\u001b[0m`)).toEqual(
      {
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-EFGH",
      },
    );
    for (const input of [
      "",
      "https://auth.openai.com/codex/device",
      CODEX_CHALLENGE.replace("auth.openai.com", "auth.openai.com.evil.test"),
      CODEX_CHALLENGE.replace("/codex/device", "/codex/other"),
      CODEX_CHALLENGE.replace("/codex/device", "/codex/device?query=x"),
      CODEX_CHALLENGE.replace("/codex/device", "/codex/device#fragment"),
      CODEX_CHALLENGE.replace("auth.openai.com", "user@auth.openai.com"),
      CODEX_CHALLENGE.replace("auth.openai.com", ":password@auth.openai.com"),
      "https://[bad ABCD-EFGH",
    ])
      expect(readCodexChallenge(input)).toBeNull();
  });

  it("allows only Claude's official PKCE flow and callback", () => {
    expect(
      readClaudeChallenge(
        `If the browser didn't open, visit: ${CLAUDE_URL}\nPaste code here if prompted >`,
      ),
    ).toEqual({ verificationUrl: CLAUDE_URL });
    for (const url of [
      "",
      CLAUDE_URL.replace("claude.com/", "evil.test/"),
      CLAUDE_URL.replace("/cai/oauth/authorize", "/other"),
      CLAUDE_URL.replace("S256", "plain"),
      CLAUDE_URL.replace("platform.claude.com", "evil.test"),
      CLAUDE_URL.replace("claude.com/", "user@claude.com/"),
      CLAUDE_URL.replace("claude.com/", ":password@claude.com/"),
    ])
      expect(readClaudeChallenge(url)).toBeNull();
  });

  it("requires Codex completion events and interprets safe failure markers", () => {
    expect(readCodexTest(CODEX_SUCCESS)).toEqual({
      ok: true,
      detail: { inputTokens: 12, outputTokens: 3 },
    });
    expect(readCodexTest('{"type":"turn.completed"}')).toEqual({
      ok: true,
      detail: {},
    });
    expect(readCodexTest('{"type":')).toMatchObject({
      errorCode: "cli_unexpected_output",
    });
    expect(readCodexTest("")).toMatchObject({ errorCode: "cli_check_failed" });
    for (const [message, errorCode] of [
      ["401 Unauthorized", "cli_auth_failed"],
      ["Usage limit reached", "provider_quota_exhausted"],
      ["429 rate limit", "provider_rate_limited"],
      ["other failure", "cli_check_failed"],
    ]) {
      const failed = JSON.stringify({
        type: "turn.failed",
        error: { message },
      });
      expect(readCodexTest(CODEX_SUCCESS + failed)).toMatchObject({
        ok: false,
        errorCode,
      });
      expect(
        readCodexTest(JSON.stringify({ type: "error", message })),
      ).toMatchObject({ ok: false, errorCode });
    }
  });

  it("treats Claude is_error as failure even if the process exited zero", () => {
    expect(readClaudeTest(CLAUDE_SUCCESS)).toEqual({
      ok: true,
      detail: {
        model: "test-model",
        inputTokens: 12,
        outputTokens: 3,
        costUsd: 0.001,
      },
    });
    expect(readClaudeTest('{"subtype":"success","is_error":false}')).toEqual({
      ok: true,
      detail: {},
    });
    expect(readClaudeTest("{")).toMatchObject({
      errorCode: "cli_unexpected_output",
    });
    expect(
      readClaudeTest('{"is_error":false,"subtype":"other"}'),
    ).toMatchObject({ errorCode: "cli_check_failed" });
    for (const [result, errorCode] of [
      [{ is_error: true, api_error_status: 401 }, "cli_auth_failed"],
      [{ is_error: true, api_error_status: 429 }, "provider_rate_limited"],
      [
        { is_error: true, result: "Not logged in · Please run /login" },
        "cli_auth_failed",
      ],
      [{ is_error: true, result: "other" }, "cli_check_failed"],
    ] as const)
      expect(readClaudeTest(JSON.stringify(result))).toMatchObject({
        errorCode,
      });
  });
});

describe.each(["codex_cli", "claude_code"] as const)(
  "%s CLI adapter",
  (provider) => {
    it("reads versions explicitly and rejects failed or malformed version output", async () => {
      const { adapter, respond, signal, children } = setup(provider);
      expect(
        await respond(
          () => adapter.version(CLI_HOME, signal),
          "tool 1.2.3 (CLI)",
        ),
      ).toEqual({ ok: true, detail: { cliVersion: "1.2.3" } });
      expect(children[0].spawnargs).toEqual(["--version"]);
      expect(
        await respond(() => adapter.version(CLI_HOME, signal), "unknown"),
      ).toMatchObject({ errorCode: "cli_unexpected_output" });
      expect(
        await respond(() => adapter.version(CLI_HOME, signal), "1.2.3", 1),
      ).toMatchObject({ errorCode: "cli_unexpected_output" });
      expect(
        await adapter.version(CLI_HOME, AbortSignal.abort()),
      ).toMatchObject({ errorCode: "check_timeout" });
    });

    it("tests with safe flags, fixed input, optional model and ignored stdin", async () => {
      const { adapter, respond, signal, spawn, children } = setup(provider);
      const output = provider === "codex_cli" ? CODEX_SUCCESS : CLAUDE_SUCCESS;
      expect(
        await respond(
          () => adapter.runTest(CLI_HOME, SELECTED, signal),
          output,
          7,
        ),
      ).toMatchObject({
        ok: true,
        detail: { inputTokens: 12, outputTokens: 3 },
      });
      const args = children[0].spawnargs;
      expect(args).toContain(MODEL_TEST_PROMPT);
      expect(args).toContain("test-model");
      expect(spawn.mock.calls[0][2].stdio).toEqual(["ignore", "pipe", "pipe"]);
      if (provider === "codex_cli")
        expect(args).toEqual(
          expect.arrayContaining([
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--ignore-user-config",
            "--ignore-rules",
            'cli_auth_credentials_store="file"',
            'forced_login_method="chatgpt"',
          ]),
        );
      else {
        expect(args).toEqual(
          expect.arrayContaining([
            "--safe-mode",
            "--strict-mcp-config",
            "--no-session-persistence",
            "--tools",
            "",
          ]),
        );
        expect(args).not.toContain("--bare");
      }
      expect(
        await respond(
          () => adapter.runTest(CLI_HOME, CLI_DEFAULTS, signal),
          output,
        ),
      ).toMatchObject({ ok: true });
      expect(children[1].spawnargs).not.toContain("test-model");
      expect(
        await adapter.runTest(CLI_HOME, CLI_DEFAULTS, AbortSignal.abort()),
      ).toMatchObject({ errorCode: "check_timeout" });
    });

    it("starts official login flows, emits one challenge and clears the handshake deadline", async () => {
      vi.useFakeTimers();
      const { adapter, children, spawn } = setup(provider);
      const onChallenge = vi.fn();
      const running = adapter.startLogin(CLI_HOME, onChallenge);
      const challenge = provider === "codex_cli" ? CODEX_CHALLENGE : CLAUDE_URL;
      children[0].stdout?.emit("data", "Preparing login\n");
      children[0].stdout?.emit("data", challenge);
      children[0].stderr?.emit("data", "waiting");
      expect(onChallenge).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20_000);
      const stdin = provider === "claude_code" ? "pipe" : "ignore";
      expect(spawn.mock.calls[0][2].stdio).toEqual([stdin, "pipe", "pipe"]);
      expect(running.write("synthetic-code")).toBe(provider === "claude_code");
      completeCli(children[0]);
      expect(await running.completed).toMatchObject({
        exitCode: 0,
        errorCode: null,
      });
      await vi.advanceTimersByTimeAsync(1_000_000);
    });

    it("times out missing challenges and expires unanswered login flows", async () => {
      vi.useFakeTimers();
      const { adapter, children } = setup(provider);
      const missing = adapter.startLogin(CLI_HOME, vi.fn());
      await vi.advanceTimersByTimeAsync(23_000);
      expect(adapter.loginError(await missing.completed)).toBe(
        "cli_unexpected_output",
      );
      const expired = adapter.startLogin(CLI_HOME, vi.fn());
      children[1].stdout?.emit(
        "data",
        provider === "codex_cli" ? CODEX_CHALLENGE : CLAUDE_URL,
      );
      await vi.advanceTimersByTimeAsync(933_000);
      expect(adapter.loginError(await expired.completed)).toBe("login_expired");
    });

    it("maps known login failures and logs out only its isolated account", async () => {
      const { adapter, respond, signal, children } = setup(provider);
      const result: CliProcessResult = {
        stdout: "",
        stderr: "",
        exitCode: 1,
        errorCode: null,
      };
      expect(adapter.loginError(result)).toBe("login_failed");
      expect(
        adapter.loginError({
          ...result,
          stderr:
            provider === "codex_cli"
              ? "NotFound"
              : "Login failed: Request failed with status code 400",
        }),
      ).toBe(
        provider === "codex_cli"
          ? "login_device_auth_unavailable"
          : "login_code_rejected",
      );
      expect(await respond(() => adapter.logout(CLI_HOME, signal), "")).toEqual(
        { ok: true, detail: {} },
      );
      expect(children[0].spawnargs).toContain("logout");
      expect(
        await respond(() => adapter.logout(CLI_HOME, signal), "", 1),
      ).toMatchObject({ errorCode: "cli_check_failed" });
      expect(await adapter.logout(CLI_HOME, AbortSignal.abort())).toMatchObject(
        { errorCode: "check_timeout" },
      );
    });
  },
);

describe("local CLI authentication status", () => {
  it("accepts Codex ChatGPT status and rejects API-key or missing login", async () => {
    const { adapter, respond, signal } = setup("codex_cli");
    expect(
      await respond(
        () => adapter.readStatus(CLI_HOME, signal),
        "",
        0,
        "Logged in using ChatGPT",
      ),
    ).toEqual({
      outcome: { ok: true, detail: { authMethod: "chatgpt" } },
      accountLabel: null,
    });
    expect(
      await respond(
        () => adapter.readStatus(CLI_HOME, signal),
        "Not logged in",
        1,
      ),
    ).toMatchObject({ outcome: { errorCode: "cli_not_logged_in" } });
    expect(
      await respond(
        () => adapter.readStatus(CLI_HOME, signal),
        "Logged in using an API key",
      ),
    ).toMatchObject({ outcome: { errorCode: "cli_not_logged_in" } });
    expect(
      await adapter.readStatus(CLI_HOME, AbortSignal.abort()),
    ).toMatchObject({ outcome: { errorCode: "check_timeout" } });
  });

  it("accepts only Claude subscription accounts and optional non-secret email labels", async () => {
    const { adapter, respond, signal } = setup("claude_code");
    const read = (status: unknown, exitCode = 0) =>
      respond(
        () => adapter.readStatus(CLI_HOME, signal),
        JSON.stringify(status),
        exitCode,
      );
    expect(
      await read({
        loggedIn: true,
        authMethod: "claude.ai",
        email: "admin@example.test",
      }),
    ).toEqual({
      outcome: { ok: true, detail: { authMethod: "claude.ai" } },
      accountLabel: "admin@example.test",
    });
    expect(
      await read({ loggedIn: true, authMethod: "claude.ai" }),
    ).toMatchObject({ accountLabel: null });
    expect(
      await read({
        loggedIn: true,
        authMethod: "claude.ai",
        email: "not an email",
      }),
    ).toMatchObject({ accountLabel: null });
    for (const status of [
      { loggedIn: false, authMethod: "none" },
      { loggedIn: true, authMethod: "api_key" },
      { loggedIn: true, authMethod: "oauth_token" },
    ])
      expect(await read(status)).toMatchObject({
        outcome: { errorCode: "cli_not_logged_in" },
      });
    expect(
      await read({ loggedIn: true, authMethod: "claude.ai" }, 1),
    ).toMatchObject({ outcome: { errorCode: "cli_not_logged_in" } });
    expect(
      await respond(() => adapter.readStatus(CLI_HOME, signal), "{"),
    ).toMatchObject({ outcome: { errorCode: "cli_unexpected_output" } });
    expect(
      await adapter.readStatus(CLI_HOME, AbortSignal.abort()),
    ).toMatchObject({ outcome: { errorCode: "check_timeout" } });
  });
});
