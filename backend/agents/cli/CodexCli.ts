import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { AgentError } from "@/backend/error/AgentErrors";

import { readCodexChallenge } from "./CliLoginParser";
import { readCodexModels } from "./CliModelCatalog";
import { readCodexTest } from "./CliResultParser";

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

const CODEX_AUTH_ARGUMENTS = [
  "-c",
  'cli_auth_credentials_store="file"',
  "-c",
  'forced_login_method="chatgpt"',
];

/** Controls the unchanged Codex binary using an isolated, file-backed ChatGPT account. */
export class CodexCli implements CliToolAdapter {
  public readonly provider = "codex_cli";
  private readonly execution: CliToolExecution;

  public constructor(execution: CliToolExecution) {
    this.execution = execution;
  }

  /** Local status proves the stored login method, not server-side account validity. */
  public async readStatus(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<CliStatusOutcome> {
    const result = await this.execution.run(
      home,
      ["login", "status", ...CODEX_AUTH_ARGUMENTS],
      signal,
    );
    if (result.errorCode)
      return {
        outcome: { ok: false, errorCode: result.errorCode, detail: {} },
        accountLabel: null,
      };
    if (
      result.exitCode === 0 &&
      /Logged in using ChatGPT/.test(`${result.stdout}\n${result.stderr}`)
    ) {
      return {
        outcome: { ok: true, detail: { authMethod: "chatgpt" } },
        accountLabel: null,
      };
    }
    return {
      outcome: { ok: false, errorCode: "cli_not_logged_in", detail: {} },
      accountLabel: null,
    };
  }

  /** Reads the installed version without using any private configuration. */
  public version(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.execution.version(home, signal);
  }

  /** Starts the official headless device flow without a custom OAuth client. */
  public startLogin(
    home: CliHome,
    onChallenge: (challenge: CliLoginChallenge) => void,
  ): CliRunningProcess {
    return this.execution.startLogin(home, {
      arguments: ["login", "--device-auth", ...CODEX_AUTH_ARGUMENTS],
      parse: readCodexChallenge,
      onChallenge,
    });
  }

  /** Converts documented failure markers without copying the CLI's diagnostic text. */
  public loginError(result: CliProcessResult): AgentErrorCode {
    if (result.errorCode === "check_timeout") return "login_expired";
    if (result.errorCode) return result.errorCode;
    if (
      /NotFound|device.*(?:disabled|not enabled)/i.test(
        `${result.stdout}\n${result.stderr}`,
      )
    )
      return "login_device_auth_unavailable";
    return "login_failed";
  }

  /** Runs a read-only, ephemeral turn in the empty work directory. */
  public async runTest(
    home: CliHome,
    selection: CliModelSelection,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--ignore-user-config",
      "--ignore-rules",
      "--color",
      "never",
      "--json",
      "-C",
      home.work,
      ...CODEX_AUTH_ARGUMENTS,
    ];
    if (selection.model !== null) args.push("-m", selection.model);
    if (selection.reasoningEffort !== null)
      args.push("-c", `model_reasoning_effort="${selection.reasoningEffort}"`);
    args.push(MODEL_TEST_PROMPT);
    const result = await this.execution.run(home, args, signal, 45_000);
    if (result.errorCode)
      return { ok: false, errorCode: result.errorCode, detail: {} };
    return readCodexTest(result.stdout);
  }

  /** Lists the catalog Codex refreshes for this connection's own ChatGPT login. */
  public async listModels(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    const result = await this.execution.readCatalog(
      home,
      ["debug", "models", ...CODEX_AUTH_ARGUMENTS],
      signal,
    );
    if (result.errorCode) throw new AgentError(result.errorCode);
    if (result.exitCode !== 0) throw new AgentError("cli_unexpected_output");
    return readCodexModels(result.stdout);
  }

  /** Logs out only this connection's file-backed login. */
  public async logout(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    const result = await this.execution.run(
      home,
      ["logout", ...CODEX_AUTH_ARGUMENTS],
      signal,
    );
    if (result.errorCode)
      return { ok: false, errorCode: result.errorCode, detail: {} };
    return result.exitCode === 0
      ? { ok: true, detail: {} }
      : { ok: false, errorCode: "cli_check_failed", detail: {} };
  }
}
