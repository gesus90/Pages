import { requireManagedOpenCodeConfiguration } from "@/backend/agents/acp/OpenCodeAcpConfiguration";
import { AgentError } from "@/backend/error/AgentErrors";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { readOpenCodeModels } from "./CliModelCatalog";
import { readOpenCodeTest } from "./CliResultParser";
import { OpenCodeCredentialStore } from "./OpenCodeCredentialStore";
import { SUPPORTED_OPENCODE_VERSION } from "./OpenCodeVersion";

import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
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
 * Pages encrypts provider keys with the existing instance cipher and supplies
 * the native credential JSON only in the child environment. Legacy native
 * files retain their exact provider. The key never reaches a prompt or another connection. Project and
 * user configuration, plugins, sharing and updates stay off.
 */
export class OpenCodeCli implements CliToolAdapter {
  public readonly provider = "opencode";
  private readonly execution: CliToolExecution;
  private readonly credentials: OpenCodeCredentialStore;

  public constructor(
    execution: CliToolExecution,
    cipher?: InstanceSecretCipher,
  ) {
    this.execution = execution;
    this.credentials = new OpenCodeCredentialStore(cipher);
  }

  /** Confirms the presence of exactly one native provider key without a model call. */
  public async readStatus(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<CliStatusOutcome> {
    signal.throwIfAborted();
    try {
      const credentials = await this.credentials.access(home);
      const { modelProvider } = credentials;
      return {
        outcome: { ok: true, detail: { modelProvider } },
        accountLabel: modelProvider,
        credentials,
      };
    } catch (error: unknown) {
      return {
        outcome: {
          ok: false,
          errorCode:
            error instanceof AgentError ? error.code : "cli_not_logged_in",
          detail: {},
        },
        accountLabel: null,
      };
    }
  }

  /** Reads the installed version only during explicit operations. */
  public async version(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    const version = await this.execution.version(home, signal);
    return version.ok &&
      version.detail.cliVersion !== SUPPORTED_OPENCODE_VERSION
      ? {
          ok: false,
          errorCode: "opencode_acp_unsupported",
          detail: version.detail,
        }
      : version;
  }

  /**
   * Encrypts the native provider credential in this connection's private folder.
   *
   * @param home - The prepared credential folder of the connection.
   * @param input - The validated native provider ID and its key.
   */
  public async storeKey(home: CliHome, input: OpenCodeKeyInput): Promise<void> {
    await this.credentials.store(home, input);
  }

  /** Runs one turn without tools in the empty work directory. */
  public async runTest(
    home: CliHome,
    selection: CliModelSelection,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    if (selection.model === null)
      return { ok: false, errorCode: "test_model_required", detail: {} };
    const credentials = await this.credentials.access(home);
    if (!selection.model.startsWith(`${credentials.modelProvider}/`))
      return { ok: false, errorCode: "plan_model_unavailable", detail: {} };
    await requireManagedOpenCodeConfiguration(home);
    const args = ["run", "--format", "json", "--pure", "-m", selection.model];
    if (selection.reasoningEffort !== null)
      args.push("--variant", selection.reasoningEffort);
    const result = await this.execution.prompt(
      home,
      {
        arguments: args,
        input: MODEL_TEST_PROMPT,
        environment: {
          ...credentials.environment,
          OPENCODE_CONFIG_CONTENT: TEST_CONFIGURATION,
        },
      },
      signal,
    );
    if (result.errorCode)
      return { ok: false, errorCode: result.errorCode, detail: {} };
    return readOpenCodeTest(credentials.redact(result.stdout));
  }

  /** Lists the models OpenCode offers for its model provider. */
  public async listModels(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    const version = await this.version(home, signal);
    if (!version.ok) throw new AgentError(version.errorCode);
    await requireManagedOpenCodeConfiguration(home);
    const credentials = await this.credentials.access(home);
    const { modelProvider } = credentials;
    const result = await this.execution.readCatalog(
      home,
      ["models", modelProvider, "--verbose"],
      signal,
      {
        environment: {
          ...credentials.environment,
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            enabled_providers: [modelProvider],
            share: "disabled",
            autoupdate: false,
          }),
        },
      },
    );
    if (result.errorCode) throw new AgentError(result.errorCode);
    if (result.exitCode !== 0) throw new AgentError("cli_unexpected_output");
    const models = readOpenCodeModels(credentials.redact(result.stdout));
    if (models.some((model) => !model.id.startsWith(`${modelProvider}/`)))
      throw new AgentError("cli_unexpected_output");
    return models;
  }

  /** Removes the stored key; OpenCode keeps no remote session to revoke. */
  public async logout(home: CliHome): Promise<ProviderCheckOutcome> {
    try {
      await this.credentials.remove(home);
      return { ok: true, detail: {} };
    } catch {
      return { ok: false, errorCode: "credential_cleanup_failed", detail: {} };
    }
  }
}
