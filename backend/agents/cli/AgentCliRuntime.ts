import { AgentError } from "@/backend/error/AgentErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { logCaughtError } from "@/backend/logging/Logger";

import { ClaudeCodeCli } from "./ClaudeCodeCli";
import { CodexCli } from "./CodexCli";
import { CliToolExecution } from "./CliToolExecution";
import { OpenCodeCli } from "./OpenCodeCli";

import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type {
  AgentCheckKind,
  CliProviderId,
} from "@/definition/AgentConnection";
import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { AgentCredentialStore } from "./AgentCredentialStore";
import type { CliLoginAdapter, CliToolAdapter } from "./CliContracts";
import type { CliLocator } from "./CliLocator";
import type { CliProcessRunner } from "./CliProcessRunner";

import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";

interface RuntimeDependencies {
  readonly tools?: AgentToolManagerService;
  readonly cipher?: InstanceSecretCipher;
  readonly store: AgentCredentialStore;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
}

/** Bridges safe connection metadata to isolated CLI adapters. */
export class AgentCliRuntime {
  private readonly dependencies: RuntimeDependencies;

  public constructor(dependencies: RuntimeDependencies) {
    this.dependencies = dependencies;
  }

  /** Ensures the approved CLI for an operation, or uses a generation pinned by a verified session. */
  public async adapter(
    provider: CliProviderId,
    file?: string,
  ): Promise<CliToolAdapter> {
    const execution = await this.execution(provider, file);
    switch (provider) {
      case "codex_cli":
        return new CodexCli(execution);
      case "claude_code":
        return new ClaudeCodeCli(execution);
      case "opencode":
        return new OpenCodeCli(execution, this.dependencies.cipher);
    }
  }

  /**
   * Resolves a CLI that signs in through its own interactive account flow.
   *
   * @throws {AgentError} `provider_invalid` for OpenCode, which signs in with a provider key.
   */
  public async loginAdapter(provider: CliProviderId): Promise<CliLoginAdapter> {
    if (provider === "opencode") throw new AgentError("provider_invalid");
    const execution = await this.execution(provider);
    return provider === "codex_cli"
      ? new CodexCli(execution)
      : new ClaudeCodeCli(execution);
  }

  /** Resolves the OpenCode adapter, which also stores the provider key. */
  public async openCode(): Promise<OpenCodeCli> {
    return new OpenCodeCli(
      await this.execution("opencode"),
      this.dependencies.cipher,
    );
  }

  /** Version, local login status and the optional test all share the caller's deadline. */
  public async check(
    connection: AgentConnectionRecord,
    kind: AgentCheckKind,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    if (isApiProvider(connection.provider))
      throw new AgentError("provider_invalid");
    try {
      const adapter = await this.adapter(connection.provider);
      const home = await this.dependencies.store.prepare(
        connection.id,
        connection.provider,
      );
      const version = await adapter.version(home, signal);
      if (!version.ok) return version;
      const status = await adapter.readStatus(home, signal);
      const outcome =
        kind === "model" && status.outcome.ok
          ? await adapter.runTest(
              home,
              {
                model: connection.testModel,
                reasoningEffort: connection.reasoningEffort,
              },
              signal,
            )
          : status.outcome;
      await this.dependencies.store.secure(connection.id, connection.provider);
      return {
        ...outcome,
        detail: {
          ...(connection.provider === "opencode" ? status.outcome.detail : {}),
          ...outcome.detail,
          ...version.detail,
        },
      };
    } catch (error: unknown) {
      logCaughtError("AgentCliRuntime", error);

      if (error instanceof AgentError)
        return { ok: false, errorCode: error.code, detail: {} };
      throw error;
    }
  }

  /**
   * Lists the CLI's own models once this connection is signed in.
   *
   * @param connection - A CLI connection.
   * @param signal - Deadline of the catalog refresh.
   * @returns The models the CLI offers, with their reasoning levels.
   * @throws {AgentError} `cli_not_logged_in` before a confirmed login, or the
   * CLI failure code.
   */
  public async listModels(
    connection: AgentConnectionRecord,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    if (isApiProvider(connection.provider))
      throw new AgentError("provider_invalid");
    if (connection.cliLoggedInAt === null)
      throw new AgentError("cli_not_logged_in");
    const adapter = await this.adapter(connection.provider);
    const home = await this.dependencies.store.prepare(
      connection.id,
      connection.provider,
    );
    const models = await adapter.listModels(home, signal);
    await this.dependencies.store.secure(connection.id, connection.provider);
    return models;
  }

  /** Local deletion remains mandatory even if the CLI cannot revoke its remote session. */
  public async cleanup(connection: AgentConnectionRecord): Promise<void> {
    if (isApiProvider(connection.provider))
      throw new AgentError("provider_invalid");
    try {
      const adapter = await this.adapter(connection.provider);
      const home = await this.dependencies.store.prepare(
        connection.id,
        connection.provider,
      );
      await adapter.logout(home, AbortSignal.timeout(15_000));
    } catch (caughtError: unknown) {
      logCaughtError("AgentCliRuntime", caughtError);

      // Directory removal is the authoritative local cleanup, including a missing CLI.
    }
    await this.dependencies.store.remove(connection.id, connection.provider);
  }

  private async execution(
    provider: CliProviderId,
    file?: string,
  ): Promise<CliToolExecution> {
    if (file)
      return new CliToolExecution(this.dependencies.runner, file, provider);
    await this.dependencies.tools?.ensureProvider(provider);
    const location = await this.dependencies.locator.find(provider);
    if (!location.path) throw new AgentError("cli_not_found");
    return new CliToolExecution(
      this.dependencies.runner,
      location.path,
      provider,
    );
  }
}
