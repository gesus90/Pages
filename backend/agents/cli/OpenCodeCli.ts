import { requireManagedOpenCodeConfiguration } from "@/backend/agents/acp/OpenCodeAcpConfiguration";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  isRetiredOpenCodeModel,
  MODEL_TEST_PROMPT,
  OPENCODE_FREE_PROVIDER,
  openCodeModelProvider,
  ZAI_CODING_PLAN_PROVIDER,
} from "@/definition/AgentConnection";
import { logCaughtError } from "@/backend/logging/Logger";

import { readOpenCodeModelList, readOpenCodeModels } from "./CliModelCatalog";
import { readOpenCodeTest } from "./CliResultParser";
import {
  OpenCodeCredentialStore,
  openCodeCredentials,
} from "./OpenCodeCredentialStore";
import { isSupportedOpenCodeVersion } from "./OpenCodeVersion";

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
import type { OpenCodeKeyInput } from "./OpenCodeCredentials";

/** A model test may use no tool at all and shares nothing. */
const TEST_CONFIGURATION = JSON.stringify({
  permission: "deny",
  share: "disabled",
  autoupdate: false,
});

/** How long the access check of a Z.AI Coding Plan key waits for Z.AI's answer. */
const CODING_PLAN_CHECK_TIMEOUT_MS = 20_000;

/**
 * Z.AI's business codes that prove an exhausted subscription quota.
 * @remarks
 * 1113 names a missing balance or resource package, 1308 and 1310 a used-up
 * usage window. The HTTP status 429 alone proves no exhausted quota, so it
 * keeps the rate-limit code of the general classification.
 */
const CODING_PLAN_QUOTA_CODE = /\\*"code\\*"\s*:\s*\\*"?(?:1113|1308|1310)\b/u;

/**
 * A Coding Plan model as the subscription offers it.
 * @remarks
 * OpenCode's catalog states a price of zero for the Coding Plan because the
 * subscription pays for it. That is no free model and no per-token price, so
 * the model carries neither a "Free" mark nor a price.
 */
function asSubscriptionModel(model: AgentCatalogModel): AgentCatalogModel {
  return { ...model, promptPrice: null, completionPrice: null, isFree: false };
}

/**
 * Narrows a failed Z.AI Coding Plan turn to an exhausted quota only on Z.AI's own evidence.
 * @param outcome - The outcome the general OpenCode classification read.
 * @param output - The redacted output of the turn.
 * @returns The outcome, with `provider_quota_exhausted` where Z.AI named a quota code.
 */
function withCodingPlanQuota(
  outcome: ProviderCheckOutcome,
  output: string,
): ProviderCheckOutcome {
  if (outcome.ok || !CODING_PLAN_QUOTA_CODE.test(output)) return outcome;
  return { ok: false, errorCode: "provider_quota_exhausted", detail: {} };
}

/**
 * Controls the unchanged OpenCode binary with one provider key per connection.
 * @remarks
 * OpenCode's free models need no key. A key stored with the connection
 * itself keeps its exact provider. Other Pages connections never supply keys.
 * Pages encrypts the connection's own key with the existing instance cipher
 * and supplies every key only in the child
 * environment, one provider per process. A key never reaches a prompt or
 * another connection. Project and user configuration, plugins, sharing and
 * updates stay off.
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
      !isSupportedOpenCodeVersion(version.detail.cliVersion ?? "")
      ? {
          ok: false,
          errorCode: "opencode_acp_unsupported",
          detail: version.detail,
        }
      : version;
  }

  /**
   * Encrypts the native provider credential in this connection's private folder.
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
    if (
      isRetiredOpenCodeModel(selection.model) ||
      !credentials.modelProviders.includes(modelProvider)
    )
      return { ok: false, errorCode: "plan_model_unavailable", detail: {} };
    await requireManagedOpenCodeConfiguration(home);
    return this.runTurn(home, {
      credentials,
      selection: { ...selection, model: selection.model },
      signal,
    });
  }

  /**
   * Proves the stored key of a Z.AI Coding Plan connection with one short turn.
   * @param home - The prepared credential folder of the connection.
   * @param selection - The saved model and effort; a model of another provider is ignored.
   * @param signal - Deadline of the whole check.
   * @returns Success with the number of listed models and the model that
   * answered; for any other key provider success without a model call.
   * @remarks
   * The catalog listing alone proves no key, so the check asks the saved
   * Coding Plan model, or the first listed one, for a single word. A listing
   * without a usable model fails with `opencode_provider_no_models`. After 20
   * seconds without an answer the check ends with `check_timeout`; the stored
   * key stays untouched in every case.
   */
  public async checkAccess(
    home: CliHome,
    selection: CliModelSelection,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    const credentials = await this.access(home);
    if (credentials.ownProvider !== ZAI_CODING_PLAN_PROVIDER)
      return { ok: true, detail: {} };
    try {
      return await this.probeCodingPlan(home, {
        credentials,
        selection,
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(CODING_PLAN_CHECK_TIMEOUT_MS),
        ]),
      });
    } catch (error: unknown) {
      logCaughtError("OpenCodeCli", error);

      if (!(error instanceof AgentError)) throw error;
      return {
        ok: false,
        errorCode: error.code,
        detail: { modelProvider: ZAI_CODING_PLAN_PROVIDER },
      };
    }
  }

  /**
   * Lists OpenCode's own free models, or the models of a Z.AI Coding Plan key.
   * @remarks
   * A connection with a Coding Plan key lists only that provider's models,
   * read with its own key and under their `zai-coding-plan/` IDs; a listing
   * without a usable model fails with `opencode_provider_no_models`. Every
   * other connection lists OpenCode's free models, independently of its key.
   */
  public async listModels(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    const version = await this.version(home, signal);
    if (!version.ok) throw new AgentError(version.errorCode);
    await requireManagedOpenCodeConfiguration(home);
    const credentials = await this.access(home);
    if (credentials.ownProvider === ZAI_CODING_PLAN_PROVIDER) {
      const models = await this.listProvider(home, {
        credentials,
        modelProvider: ZAI_CODING_PLAN_PROVIDER,
        signal,
        isEmptyAllowed: true,
      });
      if (models.length === 0)
        throw new AgentError("opencode_provider_no_models");
      return models;
    }
    const models = await this.listProvider(home, {
      credentials,
      modelProvider: OPENCODE_FREE_PROVIDER,
      signal,
    });
    return models.filter((model) => model.isFree);
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
    return openCodeCredentials(own);
  }

  private async listProvider(
    home: CliHome,
    request: {
      readonly credentials: CliCredentialAccess;
      readonly modelProvider: string;
      readonly signal: AbortSignal;
      readonly isEmptyAllowed?: boolean;
    },
  ): Promise<readonly AgentCatalogModel[]> {
    const { credentials, modelProvider, signal, isEmptyAllowed } = request;
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
    const stdout = credentials.redact(result.stdout);
    const models =
      modelProvider === ZAI_CODING_PLAN_PROVIDER
        ? readOpenCodeModelList(stdout).map(asSubscriptionModel)
        : readOpenCodeModels(stdout, { isEmptyAllowed });
    if (models.some((model) => !model.id.startsWith(`${modelProvider}/`)))
      throw new AgentError("cli_unexpected_output");
    return models;
  }

  private async probeCodingPlan(
    home: CliHome,
    request: {
      readonly credentials: CliCredentialAccess;
      readonly selection: CliModelSelection;
      readonly signal: AbortSignal;
    },
  ): Promise<ProviderCheckOutcome> {
    const { credentials, selection, signal } = request;
    await requireManagedOpenCodeConfiguration(home);
    const models = await this.listProvider(home, {
      credentials,
      modelProvider: ZAI_CODING_PLAN_PROVIDER,
      signal,
    });
    if (models.length === 0)
      return {
        ok: false,
        errorCode: "opencode_provider_no_models",
        detail: { modelProvider: ZAI_CODING_PLAN_PROVIDER },
      };
    const saved = models.find((model) => model.id === selection.model);
    const model = saved ?? models[0];
    const outcome = await this.runTurn(home, {
      credentials,
      selection: {
        model: model.id,
        reasoningEffort: saved ? selection.reasoningEffort : null,
      },
      signal,
    });
    return {
      ...outcome,
      detail: {
        ...outcome.detail,
        modelProvider: ZAI_CODING_PLAN_PROVIDER,
        modelCount: models.length,
        model: model.id,
      },
    };
  }

  private async runTurn(
    home: CliHome,
    request: {
      readonly credentials: CliCredentialAccess;
      readonly selection: CliModelSelection & { readonly model: string };
      readonly signal: AbortSignal;
    },
  ): Promise<ProviderCheckOutcome> {
    const { credentials, selection, signal } = request;
    const modelProvider = openCodeModelProvider(selection.model);
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
    const output = credentials.redact(result.stdout);
    const outcome = readOpenCodeTest(output);
    return modelProvider === ZAI_CODING_PLAN_PROVIDER
      ? withCodingPlanQuota(outcome, output)
      : outcome;
  }
}
