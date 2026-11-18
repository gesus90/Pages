import { AgentError } from "@/backend/error/AgentErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { logCaughtError } from "@/backend/logging/Logger";

import { AntigravityCli } from "./AntigravityCli";
import { ClaudeCodeCli } from "./ClaudeCodeCli";
import { CodexCli } from "./CodexCli";
import { CliToolExecution } from "./CliToolExecution";
import { prepareCliUsageHome } from "./CliUsageHome";
import { OpenCodeCli } from "./OpenCodeCli";

import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type {
  AgentCheckKind,
  CliProviderId,
} from "@/definition/AgentConnection";
import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { AntigravityQuotaGroup } from "@/definition/AntigravityQuota";
import type { AgentCredentialStore } from "./AgentCredentialStore";
import type { ClaudeUsageReading } from "./ClaudeUsageResult";
import type { CliHome, CliLoginAdapter, CliToolAdapter } from "./CliContracts";
import type { CodexUsageReading } from "./CodexUsageResult";
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

/** The login file of Claude Code inside its configuration folder. */
const CLAUDE_LOGIN_FILE = ".credentials.json";

/** The login file of Codex inside its home, with the file-backed store the connections use. */
const CODEX_LOGIN_FILE = "auth.json";

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
      case "antigravity":
        return new AntigravityCli(execution);
      case "opencode":
        return new OpenCodeCli(execution, this.dependencies.cipher);
    }
  }

  /**
   * Resolves a CLI that signs in through its own interactive account flow.
   * @throws {AgentError} `provider_invalid` for OpenCode, which signs in with a provider key.
   */
  public async loginAdapter(provider: CliProviderId): Promise<CliLoginAdapter> {
    if (provider === "opencode") throw new AgentError("provider_invalid");
    const execution = await this.execution(provider);
    if (provider === "antigravity") return new AntigravityCli(execution);
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
    // Probes share the CLI's credential home. Defer them while its native
    // session may refresh access; a transient probe must not invalidate that session.
    if (
      this.dependencies.runner.hasSession(
        this.dependencies.store.paths(connection.id, connection.provider),
      )
    )
      return { ok: false, errorCode: "check_in_progress", detail: {} };
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

  /**
   * Asks Claude Code for the subscription usage of a signed-in connection.
   * @param connection - A Claude Code connection.
   * @param signal - Deadline of the query.
   * @returns The subscription and plan windows the claude.ai usage endpoint reported.
   * @throws {AgentError} `provider_invalid` for another provider,
   * `cli_not_logged_in` before a confirmed login, or the CLI failure code.
   * @remarks
   * The query asks no model and runs beside a native session of the same
   * connection, see {@link withUsageHome}.
   */
  public async readClaudeUsage(
    connection: AgentConnectionRecord,
    signal: AbortSignal,
  ): Promise<ClaudeUsageReading> {
    if (connection.provider !== "claude_code")
      throw new AgentError("provider_invalid");
    if (connection.cliLoggedInAt === null)
      throw new AgentError("cli_not_logged_in");
    const cli = new ClaudeCodeCli(await this.execution(connection.provider));
    return this.withUsageHome(
      connection,
      connection.provider,
      CLAUDE_LOGIN_FILE,
      (home) => cli.readUsage(home, signal),
    );
  }

  /**
   * Asks the Codex app server for the general quota of a signed-in connection.
   * @param connection - A Codex connection.
   * @param signal - Deadline of the query.
   * @returns The plan, windows and limit statement the app server reported.
   * @throws {AgentError} `provider_invalid` for another provider,
   * `cli_not_logged_in` before a confirmed login, or the CLI failure code.
   * @remarks
   * The query starts no thread and no turn and runs beside a native session
   * of the same connection, see {@link withUsageHome}.
   */
  public async readCodexUsage(
    connection: AgentConnectionRecord,
    signal: AbortSignal,
  ): Promise<CodexUsageReading> {
    if (connection.provider !== "codex_cli")
      throw new AgentError("provider_invalid");
    if (connection.cliLoggedInAt === null)
      throw new AgentError("cli_not_logged_in");
    const cli = new CodexCli(await this.execution(connection.provider));
    return this.withUsageHome(
      connection,
      connection.provider,
      CODEX_LOGIN_FILE,
      (home) => cli.readUsage(home, signal),
    );
  }

  /**
   * Asks Antigravity for the quota groups of a signed-in connection.
   * @param connection - An Antigravity connection.
   * @param signal - Deadline of the query.
   * @returns The groups and windows the adapter reported.
   * @throws {AgentError} `provider_invalid` for another provider,
   * `cli_not_logged_in` before a confirmed login, `check_in_progress` while a
   * native session uses the connection's home, or the CLI failure code.
   * @remarks
   * Like every probe, the query waits while a session may refresh the
   * sign-in, so a running answer of the connection is never disturbed.
   */
  public async readAntigravityUsage(
    connection: AgentConnectionRecord,
    signal: AbortSignal,
  ): Promise<readonly AntigravityQuotaGroup[]> {
    if (connection.provider !== "antigravity")
      throw new AgentError("provider_invalid");
    if (connection.cliLoggedInAt === null)
      throw new AgentError("cli_not_logged_in");
    const { runner, store } = this.dependencies;
    if (runner.hasSession(store.paths(connection.id, connection.provider)))
      throw new AgentError("check_in_progress");
    const cli = new AntigravityCli(await this.execution(connection.provider));
    const home = await store.prepare(connection.id, connection.provider);
    try {
      return await cli.readUsage(home, signal);
    } finally {
      await store.secure(connection.id, connection.provider);
    }
  }

  /** Local deletion remains mandatory even if the CLI cannot revoke its remote session. */
  public async cleanup(connection: AgentConnectionRecord): Promise<void> {
    if (isApiProvider(connection.provider))
      throw new AgentError("provider_invalid");
    if (this.dependencies.store.isBound(connection.id, connection.provider))
      return;
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

  /**
   * Runs a usage query in the home that fits the connection's state.
   * @param connection - The connection to ask about.
   * @param provider - The CLI provider of that connection.
   * @param credentialFile - The login file of the CLI inside its configuration folder.
   * @param read - The query, which receives the home to run in.
   * @remarks
   * Without a native session the query runs in the connection's own home.
   * While a session uses that home, the query gets a private home with a copy
   * of the login only, so it never touches the files the session works with;
   * a login it refreshed is handed back only while the connection's file is
   * unchanged, so the query cannot invalidate the session's sign-in. A running
   * answer is therefore neither a reason to skip the query nor disturbed by it.
   */
  private async withUsageHome<T>(
    connection: AgentConnectionRecord,
    provider: CliProviderId,
    credentialFile: string,
    read: (home: CliHome) => Promise<T>,
  ): Promise<T> {
    const { runner, store } = this.dependencies;
    const isHeld = runner.hasSession(store.paths(connection.id, provider));
    const own = await store.prepare(connection.id, provider);
    try {
      if (!isHeld) return await read(own);
      const usage = await prepareCliUsageHome(own, credentialFile);
      try {
        return await read(usage.home);
      } finally {
        await usage.release();
      }
    } finally {
      await store.secure(connection.id, provider);
    }
  }

  private async execution(
    provider: CliProviderId,
    file?: string,
  ): Promise<CliToolExecution> {
    if (file)
      return new CliToolExecution(this.dependencies.runner, file, provider);
    // The verified generation itself, so a concurrent activation cannot split one operation across two CLIs.
    const location = this.dependencies.tools
      ? { path: (await this.dependencies.tools.ensureProvider(provider)).file }
      : await this.dependencies.locator.find(provider);
    if (!location.path) throw new AgentError("cli_not_found");
    return new CliToolExecution(
      this.dependencies.runner,
      location.path,
      provider,
    );
  }
}
