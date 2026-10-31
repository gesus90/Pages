import { AgentError } from "@/backend/error/AgentErrors";
import {
  isApiProvider,
  isLoginActive,
  isOpenCodeKeyProvider,
} from "@/definition/AgentConnection";
import { createCliTerminalCommand } from "@/backend/agents/cli/CliEnvironment";
import { CLI_BINARIES } from "@/backend/agents/cli/CliLocator";
import { readAntigravityLoopback } from "@/backend/agents/cli/CliLoginParser";
import {
  deliverAntigravityRedirect,
  readAntigravityRedirect,
} from "@/backend/agents/cli/AntigravityLoginRedirect";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  requireAgentAdministrator,
  requireAgentConnection,
} from "./AgentServiceAccess";
import { CliLoginSessionRegistry } from "./CliLoginSessionRegistry";

import type { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import type { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type {
  CliHome,
  CliLoginChallenge,
} from "@/backend/agents/cli/CliContracts";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type {
  AgentCliState,
  CliLoginView,
  CliProviderId,
  CliToolLocations,
} from "@/definition/AgentConnection";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentAccessCatalog } from "./AgentCheckService";
import type { AgentOperationRegistry } from "./AgentOperationRegistry";
import type { CliLoginSession } from "./CliLoginSessionRegistry";
import type { OpenCodeKeyInput } from "@/backend/agents/cli/OpenCodeCredentials";

/**
 * How long a login waits for the user.
 *
 * @remarks
 * The Antigravity adapter closes its loopback listener after 300 seconds; the
 * Pages session ends first, so the expiry is reported as such.
 */
const LOGIN_DURATIONS_MS: Readonly<Record<CliProviderId, number>> = {
  codex_cli: 900_000,
  claude_code: 600_000,
  opencode: 600_000,
  antigravity: 300_000,
};

interface LoginDependencies {
  readonly repository: AgentConnectionRepository;
  readonly store: AgentCredentialStore;
  readonly runtime: AgentCliRuntime;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
  readonly operations: AgentOperationRegistry;
  readonly catalog: AgentAccessCatalog;
}

/** Admin-only orchestration of official CLI account flows and safe ephemeral polling. */
export class AgentCliLoginService {
  private readonly dependencies: LoginDependencies;
  private readonly sessions = new CliLoginSessionRegistry();
  private isShuttingDown = false;

  public constructor(dependencies: LoginDependencies) {
    this.dependencies = dependencies;
  }

  /** File-only CLI discovery is safe during page loading. */
  public async tools(actor: AccountAccess): Promise<CliToolLocations> {
    requireAgentAdministrator(actor);
    return this.dependencies.locator.list();
  }

  /** Describes stored state without querying the CLI or exposing a pending device code. */
  public async describe(
    actor: AccountAccess,
    connection: AgentConnectionRecord,
  ): Promise<AgentCliState> {
    requireAgentAdministrator(actor);
    if (isApiProvider(connection.provider))
      throw new AgentError("provider_invalid");
    const location = await this.dependencies.locator.find(connection.provider);
    const home = this.dependencies.store.paths(
      connection.id,
      connection.provider,
    );
    return {
      binaryFound: location.found,
      ...(this.dependencies.store.isBound(connection.id, connection.provider)
        ? { isOperatorBound: true }
        : {}),
      loggedInAt: connection.cliLoggedInAt,
      accountLabel: connection.cliAccountLabel,
      login: this.sessions.view(connection.id, actor.userId),
      terminalCommand: createCliTerminalCommand(
        home,
        connection.provider,
        location.path ?? CLI_BINARIES[connection.provider],
      ),
    };
  }

  /** Starts one asynchronous login; only the polling route may return its challenge. */
  public async start(actor: AccountAccess, id: string): Promise<CliLoginView> {
    requireAgentAdministrator(actor);
    if (this.isShuttingDown) throw new AgentError("login_limit_reached");
    const release = this.dependencies.operations.acquire(id, "login");
    try {
      const connection = await this.requireCli(id);
      if (this.dependencies.store.isBound(id, connection.provider))
        throw new AgentError("antigravity_configuration_unmanaged");
      const adapter = await this.dependencies.runtime.loginAdapter(
        connection.provider,
      );
      if (this.isShuttingDown) throw new AgentError("login_limit_reached");
      const startedAt = Date.now();
      const visible = LOGIN_DURATIONS_MS[connection.provider];
      // Codex keeps its device code a little longer than the code is shown.
      const duration =
        connection.provider === "codex_cli" ? visible + 30_000 : visible;
      const session: CliLoginSession = {
        id,
        ownerId: actor.userId,
        provider: connection.provider,
        adapter,
        home: this.dependencies.store.loginPaths(id, connection.provider),
        expiresAt: new Date(startedAt + visible).toISOString(),
        release,
        controller: new AbortController(),
        state: "starting",
        process: null,
        task: null,
        expiry: null,
      };
      this.sessions.add(session);
      session.expiry = setTimeout(
        () => this.stop(session, "login_expired"),
        duration,
      );
      session.task = this.launch(actor, session);
      return { state: "starting", expiresAt: session.expiresAt };
    } catch (error: unknown) {
      logCaughtError("AgentCliLoginService", error);

      release();
      throw error;
    }
  }

  /**
   * Stores the provider key of an OpenCode connection in its credential folder.
   *
   * @param actor - An administrator.
   * @param id - The OpenCode connection.
   * @param input - Native model provider ID and its key, never returned.
   * @returns The confirmed sign-in state of the connection.
   * @throws {AgentError} `provider_invalid` for another connection type,
   * `api_key_invalid_format`, or the failure of the confirming status read.
   *
   * @remarks
   * Pages encrypts the key with the instance cipher in the private credential
   * folder, validates the native credential structure and loads the
   * model list; the database only learns that a key is stored.
   */
  public async storeKey(
    actor: AccountAccess,
    id: string,
    input: OpenCodeKeyInput,
  ): Promise<AgentCliState> {
    requireAgentAdministrator(actor);
    const { apiKey, modelProvider } = input;
    if (!apiKey || apiKey.length > 512 || /[\s\p{Cc}]/u.test(apiKey))
      throw new AgentError("api_key_invalid_format");
    if (!isOpenCodeKeyProvider(modelProvider))
      throw new AgentError("provider_invalid");
    await this.dependencies.operations.run(id, "login", async () => {
      const connection = await this.requireCli(id);
      if (connection.provider !== "opencode")
        throw new AgentError("provider_invalid");
      const { repository, store, runtime } = this.dependencies;
      await repository.setCliAccount(
        id,
        { loggedInAt: null, label: null },
        actor.userId,
      );
      const adapter = await runtime.openCode();
      const home = await store.prepare(id, "opencode");
      const version = await adapter.version(home, AbortSignal.timeout(10_000));
      if (!version.ok) throw new AgentError(version.errorCode);
      await adapter.storeKey(home, input);
      await repository.catalogs().invalidate(id);
      const status = await adapter.readStatus(
        home,
        AbortSignal.timeout(25_000),
      );
      await store.secure(id, "opencode");
      if (!status.outcome.ok) throw new AgentError(status.outcome.errorCode);
      await repository.setCliAccount(
        id,
        { loggedInAt: new Date().toISOString(), label: status.accountLabel },
        actor.userId,
      );
      await this.dependencies.catalog.loadAfterAccess(id);
    });
    return this.describe(actor, await this.requireCli(id));
  }

  /** Validates a one-use Claude code and writes it directly to the official CLI's pipe. */
  public async submitCode(
    actor: AccountAccess,
    id: string,
    code: string,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    await this.requireCli(id);
    if (!code.trim() || code.length > 512 || /\p{Cc}/u.test(code))
      throw new AgentError("login_code_invalid");
    const session = this.sessions.get(id);
    if (
      !session ||
      session.ownerId !== actor.userId ||
      session.provider !== "claude_code" ||
      session.state !== "awaiting_user" ||
      !session.process?.write(code)
    )
      throw new AgentError("login_not_running");
    session.state = "verifying";
    session.verificationUrl = undefined;
  }

  /**
   * Completes an Antigravity sign-in with the address Google redirected to.
   *
   * @param actor - The administrator who started this login.
   * @param id - The connection.
   * @param address - The full address from the browser after Google's consent.
   * @throws {AgentError} `login_not_running` for another user or state,
   * `login_callback_invalid` for an address of another login, and
   * `login_callback_unreachable` when the adapter no longer listens.
   *
   * @remarks
   * Supports a browser on another device, which cannot reach the adapter's
   * loopback listener itself. The address is accepted once; success shows
   * only after the adapter, the status check and the catalog confirmed it.
   */
  public async submitRedirect(
    actor: AccountAccess,
    id: string,
    address: string,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    await this.requireCli(id);
    const session = this.sessions.get(id);
    const callback = session?.loopbackCallback;
    if (
      !session ||
      !callback ||
      session.ownerId !== actor.userId ||
      session.state !== "awaiting_user"
    )
      throw new AgentError("login_not_running");
    const query = readAntigravityRedirect(address, callback);
    // The adapter's listener answers a single request, so the address is used once.
    session.loopbackCallback = undefined;
    session.state = "verifying";
    session.verificationUrl = undefined;
    // A failed delivery leaves the login to end on its own: the listener may
    // already have received the redirect from a browser on this host.
    await deliverAntigravityRedirect(
      callback,
      query,
      session.controller.signal,
    );
  }

  /** Cancellation is complete only after the child group is terminated. */
  public async cancel(actor: AccountAccess, id: string): Promise<void> {
    requireAgentAdministrator(actor);
    await this.requireCli(id);
    const session = this.sessions.get(id);
    if (!session || !isLoginActive(session.state))
      throw new AgentError("login_not_running");
    this.stop(session, "login_cancelled");
    await session.task;
  }

  /** Returns a challenge only while the protected session awaits user action. */
  public async read(
    actor: AccountAccess,
    id: string,
  ): Promise<CliLoginView | null> {
    requireAgentAdministrator(actor);
    await this.requireCli(id);
    return this.sessions.view(id, actor.userId, true);
  }

  /** Deletes local account credentials and invalidates both previous check results. */
  public async logout(actor: AccountAccess, id: string): Promise<void> {
    requireAgentAdministrator(actor);
    await this.dependencies.operations.run(id, "write", async () => {
      const connection = await this.requireCli(id);
      if (this.dependencies.store.isBound(id, connection.provider))
        throw new AgentError("antigravity_configuration_unmanaged");
      await this.dependencies.runtime.cleanup(connection);
      await this.dependencies.repository.setCliAccount(
        id,
        { loggedInAt: null, label: null },
        actor.userId,
      );
      this.sessions.forget(id);
    });
  }

  /** Called by connection deletion while that service holds the shared operation lock. */
  public async cleanup(
    actor: AccountAccess,
    connection: AgentConnectionRecord,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    await this.dependencies.runtime.cleanup(connection);
    this.sessions.forget(connection.id);
  }

  /** Drains login tasks and all CLI children before the server exits. */
  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    const active = this.sessions.active();
    for (const session of active) this.stop(session, "login_cancelled");
    await this.dependencies.runner.shutdown();
    await Promise.all(active.map((session) => session.task));
    this.sessions.clear();
  }

  private async requireCli(
    id: string,
  ): Promise<AgentConnectionRecord & { readonly provider: CliProviderId }> {
    const connection = await requireAgentConnection(
      this.dependencies.repository,
      id,
    );
    if (isApiProvider(connection.provider))
      throw new AgentError("provider_invalid");
    return { ...connection, provider: connection.provider };
  }

  private stop(
    session: CliLoginSession,
    code: "login_expired" | "login_cancelled",
  ): void {
    session.errorCode = code;
    session.controller.abort();
    session.process?.cancel(code);
  }

  private async launch(
    actor: AccountAccess,
    session: CliLoginSession,
  ): Promise<void> {
    const { repository, store } = this.dependencies;
    let isAdopted = false;
    try {
      // A separate login context keeps the valid account until the new one is confirmed.
      if (session.home.root === store.paths(session.id, session.provider).root)
        await repository.setCliAccount(
          session.id,
          { loggedInAt: null, label: null },
          actor.userId,
        );
      await store.prepareLogin(session.id, session.provider);
      await this.runLogin(session);
      session.state = "verifying";
      const label = await this.readConfirmedStatus(session, session.home);
      if (session.controller.signal.aborted)
        throw new AgentError("login_cancelled");
      await store.adoptLogin(session.id, session.provider);
      isAdopted = true;
      await this.confirm(actor, session, label);
      await this.discardLogin(session);
      this.sessions.finish(session, "succeeded");
    } catch (error: unknown) {
      logCaughtError("AgentCliLoginService", error);

      if (isAdopted) await this.clearAccount(actor, session.id);
      const code =
        session.errorCode ??
        (error instanceof AgentError ? error.code : "login_failed");
      // The staging context is gone before any end state is reported.
      await this.discardLogin(session);
      this.finishFailure(session, code);
    }
  }

  private async discardLogin(session: CliLoginSession): Promise<void> {
    await this.dependencies.store
      .discardLogin(session.id, session.provider)
      .catch((error: unknown) => logCaughtError("AgentCliLoginService", error));
  }

  /** Starts the official flow and waits until the adapter or CLI reports its end. */
  private async runLogin(session: CliLoginSession): Promise<void> {
    const signal = AbortSignal.any([
      session.controller.signal,
      AbortSignal.timeout(25_000),
    ]);
    const version = await session.adapter.version(session.home, signal);
    if (!version.ok) throw new AgentError(version.errorCode);
    if (session.controller.signal.aborted)
      throw new AgentError("login_cancelled");
    session.process = session.adapter.startLogin(session.home, (challenge) =>
      this.showChallenge(session, challenge),
    );
    const result = await session.process.completed;
    if (result.errorCode || result.exitCode !== 0)
      throw new AgentError(session.adapter.loginError(result));
  }

  private showChallenge(
    session: CliLoginSession,
    challenge: CliLoginChallenge,
  ): void {
    session.state = "awaiting_user";
    session.verificationUrl = challenge.verificationUrl;
    session.userCode = challenge.userCode;
    session.loopbackCallback =
      session.provider === "antigravity"
        ? (readAntigravityLoopback(challenge.verificationUrl) ?? undefined)
        : undefined;
  }

  /** Reads the account in the given context; only a confirmed check counts. */
  private async readConfirmedStatus(
    session: CliLoginSession,
    home: CliHome,
  ): Promise<string | null> {
    const status = await session.adapter.readStatus(
      home,
      AbortSignal.any([session.controller.signal, AbortSignal.timeout(15_000)]),
    );
    if (!status.outcome.ok) throw new AgentError(status.outcome.errorCode);
    return status.accountLabel;
  }

  /** Confirms the account in the connection context before it is shown as signed in. */
  private async confirm(
    actor: AccountAccess,
    session: CliLoginSession,
    stagedLabel: string | null,
  ): Promise<void> {
    const { repository, store } = this.dependencies;
    const home = store.paths(session.id, session.provider);
    const label =
      home.root === session.home.root
        ? stagedLabel
        : await this.readConfirmedStatus(session, home);
    if (session.controller.signal.aborted)
      throw new AgentError("login_cancelled");
    await store.secure(session.id, session.provider);
    if (session.controller.signal.aborted)
      throw new AgentError("login_cancelled");
    await repository.setCliAccount(
      session.id,
      { loggedInAt: new Date().toISOString(), label },
      actor.userId,
    );
    if (session.controller.signal.aborted) {
      await this.clearAccount(actor, session.id);
      throw new AgentError("login_cancelled");
    }
    // Still "verifying" while the list loads, so the panel waits for the result.
    await this.dependencies.catalog.loadAfterAccess(session.id);
  }

  private async clearAccount(actor: AccountAccess, id: string): Promise<void> {
    await this.dependencies.repository
      .setCliAccount(id, { loggedInAt: null, label: null }, actor.userId)
      .catch((error: unknown) => logCaughtError("AgentCliLoginService", error));
  }

  private finishFailure(session: CliLoginSession, code: AgentErrorCode): void {
    if (code === "login_cancelled")
      this.sessions.finish(session, "cancelled", code);
    else if (code === "login_expired")
      this.sessions.finish(session, "expired", code);
    else this.sessions.finish(session, "failed", code);
  }
}
