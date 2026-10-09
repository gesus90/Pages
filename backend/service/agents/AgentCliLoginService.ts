import { AgentError } from "@/backend/error/AgentErrors";
import { isApiProvider, isLoginActive } from "@/definition/AgentConnection";
import { createCliTerminalCommand } from "@/backend/agents/cli/CliEnvironment";

import {
  requireAgentAdministrator,
  requireAgentConnection,
} from "./AgentServiceAccess";
import { CliLoginSessionRegistry } from "./CliLoginSessionRegistry";

import type { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import type { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type {
  AgentCliState,
  CliLoginView,
  CliToolLocations,
} from "@/definition/AgentConnection";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentAccessCatalog } from "./AgentCheckService";
import type { AgentOperationRegistry } from "./AgentOperationRegistry";
import type { CliLoginSession } from "./CliLoginSessionRegistry";

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
      loggedInAt: connection.cliLoggedInAt,
      accountLabel: connection.cliAccountLabel,
      login: this.sessions.view(connection.id),
      terminalCommand: createCliTerminalCommand(
        home,
        connection.provider,
        location.path ??
          (connection.provider === "codex_cli" ? "codex" : "claude"),
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
      const adapter = await this.dependencies.runtime.adapter(
        connection.provider,
      );
      if (this.isShuttingDown) throw new AgentError("login_limit_reached");
      const startedAt = Date.now();
      const duration = connection.provider === "codex_cli" ? 930_000 : 600_000;
      const session: CliLoginSession = {
        id,
        provider: connection.provider,
        adapter,
        home: this.dependencies.store.paths(id, connection.provider),
        expiresAt: new Date(
          startedAt +
            (connection.provider === "codex_cli" ? 900_000 : duration),
        ).toISOString(),
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
      release();
      throw error;
    }
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
      session.provider !== "claude_code" ||
      session.state !== "awaiting_user" ||
      !session.process?.write(code)
    )
      throw new AgentError("login_not_running");
    session.state = "verifying";
    session.verificationUrl = undefined;
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
    return this.sessions.view(id, true);
  }

  /** Deletes local account credentials and invalidates both previous check results. */
  public async logout(actor: AccountAccess, id: string): Promise<void> {
    requireAgentAdministrator(actor);
    await this.dependencies.operations.run(id, "write", async () => {
      const connection = await this.requireCli(id);
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
  ): Promise<
    AgentConnectionRecord & { readonly provider: "codex_cli" | "claude_code" }
  > {
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
    try {
      await this.dependencies.repository.setCliAccount(
        session.id,
        { loggedInAt: null, label: null },
        actor.userId,
      );
      await this.dependencies.store.prepare(session.id, session.provider);
      const signal = AbortSignal.any([
        session.controller.signal,
        AbortSignal.timeout(25_000),
      ]);
      const version = await session.adapter.version(session.home, signal);
      if (!version.ok) throw new AgentError(version.errorCode);
      if (session.controller.signal.aborted)
        throw new AgentError("login_cancelled");
      session.process = session.adapter.startLogin(
        session.home,
        (challenge) => {
          session.state = "awaiting_user";
          session.verificationUrl = challenge.verificationUrl;
          session.userCode = challenge.userCode;
        },
      );
      const result = await session.process.completed;
      if (result.errorCode || result.exitCode !== 0)
        throw new AgentError(session.adapter.loginError(result));
      session.state = "verifying";
      const status = await session.adapter.readStatus(
        session.home,
        AbortSignal.any([
          session.controller.signal,
          AbortSignal.timeout(15_000),
        ]),
      );
      if (!status.outcome.ok) throw new AgentError(status.outcome.errorCode);
      if (session.controller.signal.aborted)
        throw new AgentError("login_cancelled");
      await this.dependencies.store.secure(session.id, session.provider);
      if (session.controller.signal.aborted)
        throw new AgentError("login_cancelled");
      await this.dependencies.repository.setCliAccount(
        session.id,
        { loggedInAt: new Date().toISOString(), label: status.accountLabel },
        actor.userId,
      );
      if (session.controller.signal.aborted) {
        await this.dependencies.repository.setCliAccount(
          session.id,
          { loggedInAt: null, label: null },
          actor.userId,
        );
        throw new AgentError("login_cancelled");
      }
      // Still "verifying" while the list loads, so the panel waits for the result.
      await this.dependencies.catalog.loadAfterAccess(session.id);
      this.sessions.finish(session, "succeeded");
    } catch (error: unknown) {
      const code =
        session.errorCode ??
        (error instanceof AgentError ? error.code : "login_failed");
      this.finishFailure(session, code);
    }
  }

  private finishFailure(session: CliLoginSession, code: AgentErrorCode): void {
    if (code === "login_cancelled")
      this.sessions.finish(session, "cancelled", code);
    else if (code === "login_expired")
      this.sessions.finish(session, "expired", code);
    else this.sessions.finish(session, "failed", code);
  }
}
