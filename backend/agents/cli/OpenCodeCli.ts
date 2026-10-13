import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  MODEL_TEST_PROMPT,
  OPENCODE_MODEL_PROVIDER,
} from "@/definition/AgentConnection";

import { readOpenCodeModels } from "./CliModelCatalog";
import { readOpenCodeTest } from "./CliResultParser";

import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type {
  CliHome,
  CliModelSelection,
  CliStatusOutcome,
  CliToolAdapter,
} from "./CliContracts";
import type { CliToolExecution } from "./CliToolExecution";

// OpenCode colours its listings even with NO_COLOR; the escape sequences are noise here.
const ESCAPE_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`,
  "gu",
);

/** A model test may use no tool at all and shares nothing. */
const TEST_CONFIGURATION = JSON.stringify({
  permission: "deny",
  share: "disabled",
  autoupdate: false,
});

/** OpenCode's own credential file below the data folder of the connection. */
function credentialFile(home: CliHome): string {
  return path.join(home.config, "opencode", "auth.json");
}

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

  /** OpenCode lists the keys it stores; only a key of its model provider counts. */
  public async readStatus(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<CliStatusOutcome> {
    const result = await this.execution.run(
      home,
      ["providers", "list"],
      signal,
    );
    if (result.errorCode)
      return {
        outcome: { ok: false, errorCode: result.errorCode, detail: {} },
        accountLabel: null,
      };
    const isStored = result.stdout
      .replace(ESCAPE_SEQUENCE, "")
      .split("\n")
      .some((line) => /\bOpenRouter\s+api\b/u.test(line));
    if (result.exitCode === 0 && isStored)
      return {
        outcome: { ok: true, detail: { authMethod: "openrouter" } },
        accountLabel: "OpenRouter",
      };
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

  /**
   * Stores the provider key in OpenCode's credential file of this connection.
   *
   * @param home - The prepared credential folder of the connection.
   * @param apiKey - The validated key; it is written once and never read back.
   */
  public async storeKey(home: CliHome, apiKey: string): Promise<void> {
    await mkdir(path.dirname(credentialFile(home)), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      credentialFile(home),
      JSON.stringify({
        [OPENCODE_MODEL_PROVIDER]: { type: "api", key: apiKey },
      }),
      { mode: 0o600 },
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
    const result = await this.execution.readCatalog(
      home,
      ["models", OPENCODE_MODEL_PROVIDER, "--verbose"],
      signal,
    );
    if (result.errorCode) throw new AgentError(result.errorCode);
    if (result.exitCode !== 0) throw new AgentError("cli_unexpected_output");
    return readOpenCodeModels(result.stdout);
  }

  /** Removes the stored key; OpenCode keeps no remote session to revoke. */
  public async logout(home: CliHome): Promise<ProviderCheckOutcome> {
    try {
      await rm(credentialFile(home), { force: true });
      return { ok: true, detail: {} };
    } catch {
      return { ok: false, errorCode: "credential_cleanup_failed", detail: {} };
    }
  }
}
