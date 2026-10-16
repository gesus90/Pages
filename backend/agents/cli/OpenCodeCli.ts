import { constants } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { readOpenCodeModels } from "./CliModelCatalog";
import { readOpenCodeTest } from "./CliResultParser";
import {
  openCodeCredentialFile,
  readOpenCodeModelProvider,
  requireOpenCodeCredentialDirectory,
} from "./OpenCodeCredentials";

import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type {
  CliHome,
  CliModelSelection,
  CliStatusOutcome,
  CliToolAdapter,
} from "./CliContracts";
import type { CliToolExecution } from "./CliToolExecution";
import type { OpenCodeKeyInput } from "./OpenCodeCredentials";

/** A model test may use no tool at all and shares nothing. */
const TEST_CONFIGURATION = JSON.stringify({
  permission: "deny",
  share: "disabled",
  autoupdate: false,
});

/**
 * Controls the unchanged OpenCode binary with one provider key per connection.
 *
 * @remarks
 * OpenCode keeps provider keys in its own credential file. Pages points
 * OpenCode's data folder at the credential folder of the connection, so the
 * key never reaches the database, a prompt or another connection. Project and
 * user configuration, plugins, sharing and updates stay off.
 */
export class OpenCodeCli implements CliToolAdapter {
  public readonly provider = "opencode";
  private readonly execution: CliToolExecution;

  public constructor(execution: CliToolExecution) {
    this.execution = execution;
  }

  /** Confirms the presence of exactly one native provider key without a model call. */
  public async readStatus(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<CliStatusOutcome> {
    signal.throwIfAborted();
    try {
      const modelProvider = await readOpenCodeModelProvider(home);
      return {
        outcome: { ok: true, detail: { modelProvider } },
        accountLabel: modelProvider,
      };
    } catch {
      return {
        outcome: { ok: false, errorCode: "cli_not_logged_in", detail: {} },
        accountLabel: null,
      };
    }
  }

  /** Reads the installed version only during explicit operations. */
  public version(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.execution.version(home, signal);
  }

  /**
   * Stores the provider key in OpenCode's credential file of this connection.
   *
   * @param home - The prepared credential folder of the connection.
   * @param input - The validated native provider ID and its key.
   */
  public async storeKey(home: CliHome, input: OpenCodeKeyInput): Promise<void> {
    await mkdir(path.dirname(openCodeCredentialFile(home)), {
      recursive: true,
      mode: 0o700,
    });
    await requireOpenCodeCredentialDirectory(home);
    await writeFile(
      openCodeCredentialFile(home),
      JSON.stringify({
        [input.modelProvider]: { type: "api", key: input.apiKey },
      }),
      {
        mode: 0o600,
        flag:
          constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_TRUNC |
          constants.O_NOFOLLOW,
      },
    );
  }

  /** Runs one turn without tools in the empty work directory. */
  public async runTest(
    home: CliHome,
    selection: CliModelSelection,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    if (selection.model === null)
      return { ok: false, errorCode: "test_model_required", detail: {} };
    const args = ["run", "--format", "json", "--pure", "-m", selection.model];
    if (selection.reasoningEffort !== null)
      args.push("--variant", selection.reasoningEffort);
    const result = await this.execution.prompt(
      home,
      {
        arguments: args,
        input: MODEL_TEST_PROMPT,
        environment: { OPENCODE_CONFIG_CONTENT: TEST_CONFIGURATION },
      },
      signal,
    );
    if (result.errorCode)
      return { ok: false, errorCode: result.errorCode, detail: {} };
    return readOpenCodeTest(result.stdout);
  }

  /** Lists the models OpenCode offers for its model provider. */
  public async listModels(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    const modelProvider = await readOpenCodeModelProvider(home);
    const result = await this.execution.readCatalog(
      home,
      ["models", modelProvider, "--verbose"],
      signal,
    );
    if (result.errorCode) throw new AgentError(result.errorCode);
    if (result.exitCode !== 0) throw new AgentError("cli_unexpected_output");
    return readOpenCodeModels(result.stdout);
  }

  /** Removes the stored key; OpenCode keeps no remote session to revoke. */
  public async logout(home: CliHome): Promise<ProviderCheckOutcome> {
    try {
      await rm(openCodeCredentialFile(home), { force: true });
      return { ok: true, detail: {} };
    } catch {
      return { ok: false, errorCode: "credential_cleanup_failed", detail: {} };
    }
  }
}
