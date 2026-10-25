import { requireManagedOpenCodeConfiguration } from "@/backend/agents/acp/OpenCodeAcpConfiguration";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  MODEL_TEST_PROMPT,
  OPENCODE_FREE_PROVIDER,
  openCodeModelProvider,
} from "@/definition/AgentConnection";
import { logCaughtError } from "@/backend/logging/Logger";

import { readOpenCodeModels } from "./CliModelCatalog";
import { readOpenCodeTest } from "./CliResultParser";
import {
  OpenCodeCredentialStore,
  openCodeCredentials,
} from "./OpenCodeCredentialStore";
import { SUPPORTED_OPENCODE_VERSION } from "./OpenCodeVersion";

import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type {
  CliCredentialAccess,
  CliHome,
  CliModelSelection,
  CliStatusOutcome,
  CliToolAdapter,
} from "./CliContracts";
import type { CliToolExecution } from "./CliToolExecution";
import type {
  OpenCodeKeyInput,
  OpenCodeLinkedKeys,
} from "./OpenCodeCredentials";

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
 * OpenCode's free models need no key. The keys of the linked API connections
 * in Pages are registered automatically, and a key stored with the connection
 * itself keeps its exact provider. Pages encrypts the connection's own key with
 * the existing instance cipher and supplies every key only in the child
 * environment, one provider per process. A key never reaches a prompt or
 * another connection. Project and user configuration, plugins, sharing and
 * updates stay off.
 */
export class OpenCodeCli implements CliToolAdapter {
  public readonly provider = "opencode";
  private readonly execution: CliToolExecution;
  private readonly credentials: OpenCodeCredentialStore;
  private readonly linked: OpenCodeLinkedKeys | undefined;

  public constructor(
    execution: CliToolExecution,
    cipher?: InstanceSecretCipher,
    linked?: OpenCodeLinkedKeys,
  ) {
    this.execution = execution;
    this.credentials = new OpenCodeCredentialStore(cipher);
    this.linked = linked;
  }

  /** Confirms the reachable providers without a model call; the free one needs no key. */
  public async readStatus(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<CliStatusOutcome> {
    signal.throwIfAborted();
    try {
      const credentials = await this.access(home);
      const { ownProvider } = credentials;
      return {
        outcome: {
          ok: true,
          detail: ownProvider === null ? {} : { modelProvider: ownProvider },
        },
        accountLabel: ownProvider,
        credentials,
      };
    } catch (error: unknown) {
      logCaughtError("OpenCodeCli", error);

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
    const credentials = await this.access(home);
    const modelProvider = openCodeModelProvider(selection.model);
    if (!credentials.modelProviders.includes(modelProvider))
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
          ...credentials.environmentFor(modelProvider),
          OPENCODE_CONFIG_CONTENT: TEST_CONFIGURATION,
        },
      },
      signal,
    );
    if (result.errorCode)
      return { ok: false, errorCode: result.errorCode, detail: {} };
    return readOpenCodeTest(credentials.redact(result.stdout));
  }

  /**
   * Lists the models OpenCode offers for every reachable provider.
   *
   * @remarks
   * OpenCode's own provider contributes its free models only, unless the
   * connection stores a key for it. A linked provider whose listing fails is
   * left out and logged; the free models still come.
   */
  public async listModels(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    const version = await this.version(home, signal);
    if (!version.ok) throw new AgentError(version.errorCode);
    await requireManagedOpenCodeConfiguration(home);
    const credentials = await this.access(home);
    const models: AgentCatalogModel[] = [];
    for (const modelProvider of credentials.modelProviders) {
      try {
        const listed = await this.listProvider(home, {
          credentials,
          modelProvider,
          signal,
        });
        models.push(
          ...listed.filter(
            (model) =>
              modelProvider !== OPENCODE_FREE_PROVIDER ||
              credentials.ownProvider === OPENCODE_FREE_PROVIDER ||
              model.isFree,
          ),
        );
      } catch (error: unknown) {
        if (modelProvider === OPENCODE_FREE_PROVIDER) throw error;
        logCaughtError("OpenCodeCli", error);
      }
    }
    return models;
  }

  /** Removes the stored key; OpenCode keeps no remote session to revoke. */
  public async logout(home: CliHome): Promise<ProviderCheckOutcome> {
    try {
      await this.credentials.remove(home);
      return { ok: true, detail: {} };
    } catch (caughtError: unknown) {
      logCaughtError("OpenCodeCli", caughtError);

      return { ok: false, errorCode: "credential_cleanup_failed", detail: {} };
    }
  }

  private async access(home: CliHome): Promise<CliCredentialAccess> {
    const own = await this.credentials.readOwn(home);
    return openCodeCredentials(own, (await this.linked?.read()) ?? []);
  }

  private async listProvider(
    home: CliHome,
    request: {
      readonly credentials: CliCredentialAccess;
      readonly modelProvider: string;
      readonly signal: AbortSignal;
    },
  ): Promise<readonly AgentCatalogModel[]> {
    const { credentials, modelProvider, signal } = request;
    const result = await this.execution.readCatalog(
      home,
      ["models", modelProvider, "--verbose"],
      signal,
      {
        environment: {
          ...credentials.environmentFor(modelProvider),
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
}
