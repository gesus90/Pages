import { readTicketAssetInput } from "@/backend/agents/TicketAssetInput";
import { acpDriverFor } from "@/backend/agents/acp/AcpDrivers";
import { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import { AcpSession } from "@/backend/agents/acp/AcpSession";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import {
  isAcpPermissionMode,
  isAcpProvider,
} from "@/definition/AgentConfiguration";
import { isApiProvider } from "@/definition/AgentConnection";

import { CliPlanIsolation } from "./CliPlanIsolation";
import { CliPlanSession } from "./CliPlanSession";
import { createCliEnvironment } from "./CliEnvironment";
import { closeCliSession } from "./CliSessionCloseout";
import { createCliSessionState } from "./CliSessionEvents";
import { planCliSession, unsupportedRunOption } from "./CliSessionPlans";

import type {
  AgentPlanSessionInput,
  PlanSession,
  PlanSessionObserver,
  PlanSessionRunner,
} from "@/backend/agents/AgentPlanExecution";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { AgentCliRuntime } from "./AgentCliRuntime";
import type { AgentCredentialStore } from "./AgentCredentialStore";
import type { CliHome, CliSessionRequest } from "./CliContracts";
import type { CliLocator } from "./CliLocator";
import type { CliProcessRunner } from "./CliProcessRunner";
import type {
  CliGitHubAccess,
  CliGitHubCredentials,
} from "./CliGitHubCredentials";
import type { CliSessionProcess } from "./CliSessionProcess";

/** How CLI runs are kept away from the instance folders. */
export interface CliIsolationOptions {
  /** Folders a CLI run must not reach, such as the data and agent folders. */
  readonly protectedDirectories: readonly string[];
  /** Refuse a run instead of starting it unisolated when bubblewrap does not work. */
  readonly isRequired: boolean;
  /** Decides whether bubblewrap works; defaults to a real probe. */
  readonly probe?: () => Promise<boolean>;
}

interface SessionDependencies {
  readonly runtime: Pick<AgentCliRuntime, "adapter">;
  readonly store: Pick<AgentCredentialStore, "prepare" | "secure">;
  readonly locator: Pick<CliLocator, "find" | "locate">;
  readonly runner: Pick<CliProcessRunner, "startSession">;
  /** Absent disables the isolation. */
  readonly isolation?: CliIsolationOptions;
  readonly github?: Pick<CliGitHubCredentials, "prepare">;
}

/** What a session start has verified about its connection. */
interface VerifiedStart {
  readonly provider: CliProviderId;
  readonly home: CliHome;
  readonly file: string;
  /** The ACP adapter of a Codex or Claude Code connection; `null` for the runners without ACP. */
  readonly adapter: string | null;
}

/** The stop signal and the observer of one session start. */
interface SessionControl {
  readonly signal: AbortSignal;
  readonly observer: PlanSessionObserver;
}

/** A session request, wrapped in the namespace where bubblewrap works. */
interface IsolatedRequest {
  readonly request: CliSessionRequest;
  readonly isIsolated: boolean;
}

/**
 * Starts the CLI sessions of plan nodes in their authorized workspaces.
 *
 * @remarks
 * Every session uses the credential folder of its connection, the exact model
 * and effort of the agent and only managed switches. The local sign-in is
 * checked and the executor is authorized again right before the process
 * starts; the prompt and every credential stay out of the argument list.
 * Codex and Claude Code run as ACP sessions through their adapters, each in
 * one of its two modes; there is no fallback to another runner.
 */
export class CliSessionExecution implements PlanSessionRunner {
  private readonly dependencies: SessionDependencies;
  private readonly isolation: CliPlanIsolation | null;
  private readonly isIsolationRequired: boolean;
  private hasWarnedWithoutIsolation = false;

  public constructor(dependencies: SessionDependencies) {
    this.dependencies = dependencies;
    const { isolation } = dependencies;
    this.isolation = isolation
      ? new CliPlanIsolation(isolation.protectedDirectories, isolation.probe)
      : null;
    this.isIsolationRequired = isolation?.isRequired === true;
  }

  /**
   * Starts the session of one node; the returned session is already running.
   *
   * @throws {AgentError} `plan_run_option_unsupported` or
   * `codex_permission_mode_required` for options the runner cannot enforce,
   * `cli_not_logged_in` without a confirmed sign-in, the missing-adapter code
   * of the runner or `plan_codex_configuration_unmanaged` before an ACP
   * session, `plan_yolo_isolation_unavailable` for YOLO without the
   * namespace, or a start failure; {@link AgentPlanCancelledError} after a
   * stop.
   */
  public async open(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession> {
    const start = await this.verify(input, signal);
    try {
      return await this.spawn(input, start, { signal, observer });
    } catch (error: unknown) {
      await this.dependencies.store.secure(
        input.agent.connection.id,
        start.provider,
      );
      throw error;
    }
  }

  private async verify(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
  ): Promise<VerifiedStart> {
    const { provider, id } = input.agent.connection;
    if (isApiProvider(provider)) throw new AgentError("provider_invalid");
    const unsupported = unsupportedRunOption(provider, input.options);
    if (unsupported !== null) throw new AgentError(unsupported);
    const { runtime, store, locator } = this.dependencies;
    const home = await store.prepare(id, provider);
    try {
      const adapter = await runtime.adapter(provider);
      const status = await adapter.readStatus(home, signal);
      if (signal.aborted) throw new AgentPlanCancelledError();
      if (!status.outcome.ok)
        throw new AgentError(
          status.outcome.errorCode === "cli_not_logged_in"
            ? "cli_not_logged_in"
            : "plan_step_failed",
        );
      const location = await locator.find(provider);
      if (!location.path) throw new AgentError("cli_not_executable");
      const acpAdapter = isAcpProvider(provider)
        ? await this.verifyAcp(acpDriverFor(provider), input, home)
        : null;
      await input.beforeStart?.();
      if (signal.aborted) throw new AgentPlanCancelledError();
      return { provider, home, file: location.path, adapter: acpAdapter };
    } catch (error: unknown) {
      await store.secure(id, provider);
      throw error;
    }
  }

  /** Finds the adapter and refuses configuration files Pages does not manage. */
  private async verifyAcp(
    driver: AcpDriver,
    input: AgentPlanSessionInput,
    home: CliHome,
  ): Promise<string> {
    const location = await this.dependencies.locator.locate(driver.binary);
    if (!location.path) throw new AgentError(driver.errors.adapterMissing);
    await driver.requireManagedConfiguration(home, input.directory);
    return location.path;
  }

  private async spawn(
    input: AgentPlanSessionInput,
    start: VerifiedStart,
    control: SessionControl,
  ): Promise<PlanSession> {
    if (isAcpProvider(start.provider))
      return this.spawnAcp(acpDriverFor(start.provider), input, start, control);
    if ((await readTicketAssetInput(input)).length > 0)
      throw new AgentError("parameter_asset_transfer_unsupported");
    const plan = planCliSession(start.provider, {
      instanceId: input.instanceId,
      model: input.agent.model,
      reasoningEffort: input.agent.reasoningEffort,
      options: input.options,
      directory: input.directory,
      prompt: input.prompt,
      mcp: input.mcp,
    });
    const state = createCliSessionState();
    const buffered: string[] = [];
    let session: CliPlanSession | null = null;
    const { request } = await this.isolate({
      file: start.file,
      provider: start.provider,
      home: start.home,
      arguments: plan.arguments,
      workingDirectory: input.directory,
      environment: plan.environment,
      timeoutMs: input.options.timeoutMinutes * 60_000,
      signal: control.signal,
      onLine: (line) => {
        if (session) session.receive(line);
        else buffered.push(line);
      },
    });
    const child = this.dependencies.runner.startSession(request);
    session = new CliPlanSession(child, {
      provider: start.provider,
      instanceId: input.instanceId,
      plan,
      state,
      observer: control.observer,
      secure: () =>
        this.dependencies.store.secure(
          input.agent.connection.id,
          start.provider,
        ),
    });
    for (const line of buffered.splice(0)) session.receive(line);
    control.observer.started({
      mode: plan.mode,
      processId: child.processId,
      startedAt: new Date().toISOString(),
      arguments: request.arguments,
      unattended: plan.unattended,
    });
    child.write(plan.input);
    if (plan.mode === "one_shot") child.endInput();
    return session;
  }

  /**
   * Starts the ACP adapter of the runner and its session in the stored mode.
   *
   * @remarks
   * "Nur Lesen" also gets its working copy read-only in the namespace. YOLO
   * runs the runner without an approval step, so only the namespace keeps it
   * inside its workspace and away from the instance folders and other
   * credentials; without the namespace YOLO does not start.
   */
  private async spawnAcp(
    driver: AcpDriver,
    input: AgentPlanSessionInput,
    start: VerifiedStart,
    control: SessionControl,
  ): Promise<PlanSession> {
    const mode = input.options.access;
    if (!isAcpPermissionMode(mode))
      throw new AgentError(driver.errors.modeRequired);
    if (start.adapter === null)
      throw new AgentError(driver.errors.adapterMissing);
    const profile = driver.profile(mode);
    const launch = driver.plan({
      instanceId: input.instanceId,
      runnerFile: start.file,
      profile,
      mcp: input.mcp,
    });
    const channel = new AcpLineChannel();
    const github = await this.prepareGitHub(input, start, mode);
    let child: CliSessionProcess | null = null;
    try {
      const { request, isIsolated } = await this.isolate({
        file: start.adapter,
        provider: start.provider,
        home: start.home,
        arguments: [],
        workingDirectory: input.directory,
        isWorkingDirectoryReadOnly: mode === "read_only",
        credentialDirectory: github?.directory,
        environment: { ...launch.environment, ...github?.environment },
        timeoutMs: input.options.timeoutMinutes * 60_000,
        signal: control.signal,
        onLine: (line) => channel.receive(github?.redact(line) ?? line),
      });
      if (mode === "yolo" && !isIsolated)
        throw new AgentError("plan_yolo_isolation_unavailable");
      if (control.signal.aborted) throw new AgentPlanCancelledError();
      child = this.dependencies.runner.startSession(request);
      const running = child;
      channel.attach((line) => running.write(line));
      void child.exited.then(() => channel.close());
      control.observer.started({
        mode: "interactive",
        processId: child.processId,
        startedAt: new Date().toISOString(),
        arguments: request.arguments,
        unattended: profile.unattended,
      });
      return new AcpSession(child, channel.stream, {
        instanceId: input.instanceId,
        driver,
        profile,
        request: {
          directory: input.directory,
          prompt: input.prompt,
          ticketInputs: input.ticketInputs,
          readTicketAssets: input.readTicketAssets,
          model: input.agent.model,
          reasoningEffort: input.agent.reasoningEffort,
          mcpServers: launch.mcpServers,
          sessionMeta: launch.sessionMeta,
        },
        observer: control.observer,
        signal: control.signal,
        isolation: isolationLabel(isIsolated, mode, driver),
        github: github?.status,
        redact: github?.redact,
        secure: () => this.secureAcp(input, start, github),
      });
    } catch (error: unknown) {
      try {
        if (child !== null) {
          child.cancel("login_cancelled");
          await closeCliSession(child, input.instanceId);
        }
      } finally {
        await github?.cleanup();
      }
      throw error;
    }
  }

  private async prepareGitHub(
    input: AgentPlanSessionInput,
    start: VerifiedStart,
    mode: AcpPermissionMode,
  ): Promise<CliGitHubAccess | null> {
    if (!this.dependencies.github) return null;
    const access =
      mode === "yolo" && input.github
        ? await input.github()
        : ({
            status: "unavailable",
            reason:
              mode === "read_only"
                ? "read-only session"
                : "no authorized project connection",
          } as const);
    const gh =
      access.status === "available"
        ? (await this.dependencies.locator.locate("gh")).path
        : null;
    return this.dependencies.github.prepare({
      instanceId: input.instanceId,
      access,
      gh,
      searchPath: createCliEnvironment(
        start.home,
        start.provider,
        start.adapter ?? start.file,
      ).PATH,
    });
  }

  private async secureAcp(
    input: AgentPlanSessionInput,
    start: VerifiedStart,
    github: CliGitHubAccess | null,
  ): Promise<void> {
    try {
      await github?.cleanup();
    } finally {
      await this.dependencies.store.secure(
        input.agent.connection.id,
        start.provider,
      );
    }
  }

  /**
   * Runs in a mount namespace that hides the instance folders, where bubblewrap works.
   *
   * @remarks
   * Where it does not, the session starts as before and one warning says so,
   * unless the operator demanded isolation: then the node fails before any process.
   */
  private async isolate(request: CliSessionRequest): Promise<IsolatedRequest> {
    if (this.isolation === null) return { request, isIsolated: false };
    const isolated = await this.isolation.isolate(request);
    if (isolated !== null) return { request: isolated, isIsolated: true };
    if (this.isIsolationRequired)
      throw new AgentError("cli_isolation_unavailable");
    if (!this.hasWarnedWithoutIsolation) {
      this.hasWarnedWithoutIsolation = true;
      console.warn(
        "Pages runs CLI agents without a mount namespace because bubblewrap does not work on this host. Install it, or set PAGES_CLI_ISOLATION=required to refuse such runs.",
      );
    }
    return { request, isIsolated: false };
  }
}

function isolationLabel(
  isIsolated: boolean,
  mode: AcpPermissionMode,
  driver: AcpDriver,
): string {
  if (!isIsolated)
    return driver.provider === "codex_cli"
      ? "none, the Codex sandbox only"
      : "none, the permission handling of Pages only";
  return mode === "read_only"
    ? "bubblewrap, workspace read-only"
    : "bubblewrap";
}
