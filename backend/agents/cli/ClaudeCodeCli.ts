import { readAgentObject } from "@/backend/agents/AgentPayload";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { AgentError } from "@/backend/error/AgentErrors";

import { readClaudeChallenge } from "./CliLoginParser";
import { readClaudeModels } from "./CliModelCatalog";
import { readClaudeTest } from "./CliResultParser";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type {
  CliHome,
  CliLoginChallenge,
  CliModelSelection,
  CliProcessResult,
  CliRunningProcess,
  CliStatusOutcome,
  CliToolAdapter,
} from "./CliContracts";
import type { CliToolExecution } from "./CliToolExecution";

function accountLabel(status: Record<string, unknown>): string | null {
  const email = status.email;
  return typeof email === "string" &&
    /^[^\s@\p{Cc}]{1,100}@[^\s@\p{Cc}]{1,100}$/u.test(email)
    ? email
    : null;
}

/** Controls Claude's own subscription login flow without reading or handling OAuth tokens. */
export class ClaudeCodeCli implements CliToolAdapter {
  public readonly provider = "claude_code";
  private readonly execution: CliToolExecution;

  public constructor(execution: CliToolExecution) {
    this.execution = execution;
  }

  /** Rejects API-key, token and third-party login modes even if the CLI says loggedIn. */
  public async readStatus(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<CliStatusOutcome> {
    const result = await this.execution.run(
      home,
      ["auth", "status", "--json"],
      signal,
    );
    if (result.errorCode)
      return {
        outcome: { ok: false, errorCode: result.errorCode, detail: {} },
        accountLabel: null,
      };
    let status: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      status = readAgentObject(parsed);
    } catch {
      return {
        outcome: { ok: false, errorCode: "cli_unexpected_output", detail: {} },
        accountLabel: null,
      };
    }
    if (
      result.exitCode === 0 &&
      status.loggedIn === true &&
      status.authMethod === "claude.ai"
    ) {
      return {
        outcome: { ok: true, detail: { authMethod: "claude.ai" } },
        accountLabel: accountLabel(status),
      };
    }
    return {
      outcome: { ok: false, errorCode: "cli_not_logged_in", detail: {} },
      accountLabel: null,
    };
  }

  /** Reads the installed version only during explicit operations. */
  public version(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.execution.version(home, signal);
  }

  /** The official login process accepts the admin's code on its stdin pipe. */
  public startLogin(
    home: CliHome,
    onChallenge: (challenge: CliLoginChallenge) => void,
  ): CliRunningProcess {
    return this.execution.startLogin(home, {
      arguments: ["auth", "login", "--claudeai"],
      parse: readClaudeChallenge,
      onChallenge,
    });
  }

  /** A rejected code requires a new official login flow. */
  public loginError(result: CliProcessResult): AgentErrorCode {
    if (result.errorCode === "check_timeout") return "login_expired";
    if (result.errorCode) return result.errorCode;
    if (
      /Login failed:.*(?:400|invalid.*code)/is.test(
        `${result.stdout}\n${result.stderr}`,
      )
    )
      return "login_code_rejected";
    return "login_failed";
  }

  /** Disables tools, user instructions, hooks, MCP, plugins and persistent sessions. */
  public async runTest(
    home: CliHome,
    selection: CliModelSelection,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    const args = [
      "-p",
      MODEL_TEST_PROMPT,
      "--output-format",
      "json",
      "--max-turns",
      "1",
      "--tools",
      "",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--safe-mode",
    ];
    if (selection.model !== null) args.push("--model", selection.model);
    if (selection.reasoningEffort !== null)
      args.push("--effort", selection.reasoningEffort);
    const result = await this.execution.run(home, args, signal, 45_000);
    if (result.errorCode)
      return { ok: false, errorCode: result.errorCode, detail: {} };
    return readClaudeTest(result.stdout);
  }

  /** Reads the CLI picker through SDK initialization; no user prompt is sent. */
  public async listModels(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    const result = await this.execution.readCatalog(
      home,
      [
        "--print",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--safe-mode",
      ],
      signal,
      `${JSON.stringify({
        type: "control_request",
        request_id: "pages-model-catalog",
        request: {
          subtype: "initialize",
          hooks: {},
          agents: {},
          sdkMcpServers: [],
        },
      })}\n`,
    );
    if (result.errorCode) throw new AgentError(result.errorCode);
    if (result.exitCode !== 0) throw new AgentError("cli_unexpected_output");
    return readClaudeModels(result.stdout);
  }

  /** Logs out the Pages-owned Claude configuration directory. */
  public async logout(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    const result = await this.execution.run(home, ["auth", "logout"], signal);
    if (result.errorCode)
      return { ok: false, errorCode: result.errorCode, detail: {} };
    return result.exitCode === 0
      ? { ok: true, detail: {} }
      : { ok: false, errorCode: "cli_check_failed", detail: {} };
  }
}
