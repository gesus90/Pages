import { agentPlaywrightServer } from "@/backend/service/agents/tools/AgentPlaywrightSession";
import {
  pinnedAgentToolDriver,
  agentToolAdapterVersion,
  prepareAgentToolSession,
  observeAgentToolSession,
  superviseAgentToolSession,
} from "@/backend/service/agents/tools/AgentToolSession";
import { providerToolIds } from "@/backend/service/agents/tools/AgentToolRegistry";
import { acpDriverFor } from "@/backend/agents/acp/AcpDrivers";
import { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import { AcpSession } from "@/backend/agents/acp/AcpSession";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import {
  isAcpPermissionMode,
  isAcpProvider,
} from "@/definition/AgentConfiguration";
import {
  isApiProvider,
  openCodeModelProvider,
} from "@/definition/AgentConnection";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import {
  assetSession,
  sessionAssetWorkspace,
  prepareSessionAssets,
  cleanupSessionAssets,
} from "./CliAssetWorkspace";
import { CliPlanIsolation } from "./CliPlanIsolation";
import { createCliEnvironment } from "./CliEnvironment";
import { ACP_WORKER_LIMITS } from "./CliWorkerUnit";
import { closeCliSession } from "./CliSessionCloseout";
import { sessionRunOptionError } from "./CliSessionPlans";

import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import type { AgentToolId } from "@/definition/AgentTools";
import type { AgentToolLocation } from "@/backend/service/agents/tools/AgentToolContracts";
import type {
  AgentPlanSessionInput,
  PlanSession,
  PlanSessionObserver,
  PlanSessionRunner,
} from "@/backend/agents/AgentPlanExecution";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";
import type { AcpSessionRequest } from "@/backend/agents/acp/AcpSession";
import type {
  AcpPermissionMode,
  NativeAcpProviderId,
} from "@/definition/AgentConfiguration";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { AgentCliRuntime } from "./AgentCliRuntime";
import type { AgentCredentialStore } from "./AgentCredentialStore";
import type {
  CliCredentialAccess,
  CliHome,
  CliSessionRequest,
  CliStatusOutcome,
} from "./CliContracts";
import type { CliLocator } from "./CliLocator";
import type { CliProcessRunner } from "./CliProcessRunner";
import type {
  CliGitHubAccess,
  CliGitHubCredentials,
} from "./CliGitHubCredentials";
import type { CliSessionProcess } from "./CliSessionProcess";
import type { CliWorkerUnits } from "./CliWorkerUnit";

/** How CLI runs are kept away from the instance folders. */
export interface CliIsolationOptions {
  /** Folders a CLI run must not reach, such as the data and agent folders. */
  readonly protectedDirectories: readonly string[];
  /** Refuse a run instead of starting it unisolated when bubblewrap does not work. */
  readonly isRequired: boolean;
  /** Explicit read-only tool mounts after the service home has been hidden. */
  readonly readOnlyDirectories?: readonly string[];
  /** Service homes hidden before rebinding the authorized workspace and this connection. */
  readonly hiddenDirectories?: readonly string[];
  /** Decides whether bubblewrap works; defaults to a real probe. */
  readonly probe?: () => Promise<boolean>;
}

interface SessionDependencies {
  readonly tools?: AgentToolManagerService;
  readonly resources?: AcpResourceScheduler;
  readonly runtime: Pick<AgentCliRuntime, "adapter">;
  readonly store: Pick<AgentCredentialStore, "prepare" | "secure">;
  readonly locator: Pick<CliLocator, "find" | "locate">;
  readonly runner: Pick<CliProcessRunner, "startSession">;
  /** Absent disables the isolation. */
  readonly isolation?: CliIsolationOptions;
  /** The limited units every worker starts in; Pica refuses to start without them. */
  readonly units?: Pick<CliWorkerUnits, "isAvailable" | "wrap">;
  readonly github?: Pick<CliGitHubCredentials, "prepare">;
}

/** What a session start has verified about its connection. */
interface VerifiedStart {
  readonly provider: CliProviderId;
  readonly home: CliHome;
  readonly file: string;
  /** The ACP entry point of this CLI connection. */
  readonly adapter: string | null;
  readonly adapterVersion?: string | null;
  readonly credentials?: CliCredentialAccess;
  readonly browser?: Awaited<ReturnType<typeof agentPlaywrightServer>>;
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

/** A session request, wrapped in its limited unit where the service manager provides one. */
interface LimitedRequest {
  readonly request: CliSessionRequest;
  /** How the run record describes the limits. */
  readonly label: string;
}

/**
 * Starts the CLI sessions of plan nodes in their authorized workspaces.
 *
 * @remarks
 * Every session uses the credential folder of its connection, the exact model
 * and effort of the agent and only managed switches. The local sign-in is
 * checked and the executor is authorized again right before the process
 * starts; the prompt and every credential stay out of the argument list.
 * Codex, Claude Code and OpenCode run as ACP sessions, each in
 * one of its two modes; there is no fallback to another runner.
 */
export class CliSessionExecution implements PlanSessionRunner {
  private readonly dependencies: SessionDependencies;
  private readonly isolation: CliPlanIsolation | null;
  private readonly isIsolationRequired: boolean;
  private hasWarnedWithoutIsolation = false;
  private hasWarnedWithoutUnits = false;

  public constructor(dependencies: SessionDependencies) {
    this.dependencies = dependencies;
    const { isolation } = dependencies;
    this.isolation = isolation
      ? new CliPlanIsolation(
          isolation.protectedDirectories,
          isolation.probe,
          isolation,
        )
      : null;
    this.isIsolationRequired =
      dependencies.tools !== undefined || isolation?.isRequired === true;
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
    const provider = sessionAcpProvider(input);
    if (provider !== null && this.dependencies.resources)
      return this.dependencies.resources.open(
        {
          instanceId: input.instanceId,
          userId: input.userId,
          provider,
          runId: input.resourceContext?.runId ?? null,
          stepId: input.resourceContext?.stepId ?? null,
        },
        signal,
        (admitted) => this.openAdmitted(input, admitted, observer),
        observer,
      );
    return this.openAdmitted(input, signal, observer);
  }

  private async openAdmitted(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession> {
    const { tools } = this.dependencies;
    const locations = tools
      ? await prepareAgentToolSession({
          manager: tools,
          request: input,
          signal,
        })
      : undefined;
    let hasVerified = false;
    const assets = sessionAssetWorkspace(input);
    try {
      input = await prepareSessionAssets(input, assets);
      const start = await this.verify(input, signal, locations);
      hasVerified = true;
      const watched = tools
        ? observeAgentToolSession(tools, input.instanceId, observer)
        : observer;
      const session = await this.spawn(input, start, {
        signal,
        observer: watched,
      });
      return tools
        ? superviseAgentToolSession(
            tools,
            input.instanceId,
            assetSession(session, assets),
          )
        : assetSession(session, assets);
    } catch (error: unknown) {
      logCaughtError("CliSessionExecution", error);

      if (!(error instanceof AcpCleanupUnconfirmedError))
        tools?.supervisor.release(input.instanceId);
      await cleanupSessionAssets(assets, error);
      const provider = input.agent.connection.provider;
      if (hasVerified && !isApiProvider(provider))
        await this.dependencies.store
          .secure(input.agent.connection.id, provider)
          .catch((secureError: unknown) => {
            logCaughtError("CliSessionExecution", secureError);

            if (!(error instanceof AcpCleanupUnconfirmedError))
              throw secureError;
          });
      throw error;
    }
  }

  private async verify(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    locations?: ReadonlyMap<AgentToolId, AgentToolLocation>,
  ): Promise<VerifiedStart> {
    const { provider, id } = input.agent.connection;
    if (isApiProvider(provider)) throw new AgentError("provider_invalid");
    const unsupported = sessionRunOptionError(input);
    if (unsupported !== null) throw new AgentError(unsupported);
    const { store, locator } = this.dependencies;
    const home = await store.prepare(id, provider);
    try {
      const pinned = locations?.get(providerToolIds(provider)[0])?.file;
      const status = await this.readStatus(provider, home, signal, pinned);
      this.dependencies.tools?.recordAuthentication(
        id,
        provider,
        status.outcome.ok,
      );
      validateSessionStatus(input, status, signal);
      const location = pinned ? { path: pinned } : await locator.find(provider);
      if (!location.path) throw new AgentError("cli_not_executable");
      const acpProvider = sessionAcpProvider(input);
      const acpAdapter =
        acpProvider !== null
          ? await this.verifyAcp(acpDriverFor(acpProvider), input, {
              home,
              locations,
            })
          : null;
      await input.beforeStart?.();
      if (signal.aborted) throw new AgentPlanCancelledError();
      return {
        provider,
        home,
        file: location.path,
        adapter: acpAdapter,
        adapterVersion: agentToolAdapterVersion(provider, locations),
        credentials: status.credentials,
        browser: locations
          ? await agentPlaywrightServer(input, locations)
          : null,
      };
    } catch (error: unknown) {
      logCaughtError("CliSessionExecution", error);

      await store.secure(id, provider);
      throw error;
    }
  }

  private async readStatus(
    provider: CliProviderId,
    home: CliHome,
    signal: AbortSignal,
    file?: string,
  ): Promise<CliStatusOutcome> {
    const adapter = file
      ? await this.dependencies.runtime.adapter(provider, file)
      : await this.dependencies.runtime.adapter(provider);
    if (provider === "opencode") {
      const version = await adapter.version(home, signal);
      if (!version.ok) throw new AgentError(version.errorCode);
    }
    return adapter.readStatus(home, signal);
  }

  /** Finds the adapter and refuses configuration files Pages does not manage. */
  private async verifyAcp(
    driver: AcpDriver,
    input: AgentPlanSessionInput,
    verified: {
      readonly home: CliHome;
      readonly locations?: ReadonlyMap<AgentToolId, AgentToolLocation>;
    },
  ): Promise<string> {
    const { home, locations } = verified;
    const adapterId = providerToolIds(driver.provider).at(-1);
    const pinned = adapterId ? locations?.get(adapterId) : null;
    const location = pinned
      ? { path: pinned.file }
      : await this.dependencies.locator.locate(driver.binary);
    if (!location.path) throw new AgentError(driver.errors.adapterMissing);
    await driver.requireManagedConfiguration(home, input.directory);
    return location.path;
  }

  private async spawn(
    input: AgentPlanSessionInput,
    start: VerifiedStart,
    control: SessionControl,
  ): Promise<PlanSession> {
    const acpProvider = sessionAcpProvider(input);
    if (acpProvider === null) throw new AgentError("provider_invalid");
    return this.spawnAcp(acpDriverFor(acpProvider), input, start, control);
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
    const purpose = input.chat ? "chat" : "plan";
    const profile = driver.profile(mode, purpose);
    const launch = driver.plan({
      instanceId: input.instanceId,
      runnerFile: start.file,
      profile,
      mcp: input.mcp,
      purpose,
      model: {
        model: input.agent.model,
        reasoningEffort: input.agent.reasoningEffort,
      },
    });
    const channel = new AcpLineChannel();
    channel.enableAcknowledgement();
    const github = await this.prepareGitHub(input, start, mode);
    const redact = (text: string): string => {
      const withoutKey = start.credentials?.redact(text) ?? text;
      let masked = github?.redact(withoutKey) ?? withoutKey;
      for (const secret of [
        input.mcp?.token,
        launch.environment.OPENCODE_SERVER_PASSWORD,
      ]) {
        if (secret) masked = masked.replaceAll(secret, "[redacted]");
      }
      return masked;
    };
    let child: CliSessionProcess | null = null;
    let limited: LimitedRequest | null = null;
    try {
      const { request, isIsolated } = await this.isolate({
        file: start.adapter,
        provider: start.provider,
        home: start.home,
        arguments: driver.arguments ?? [],
        workingDirectory: input.directory,
        isWorkingDirectoryReadOnly: mode === "read_only",
        credentialDirectory: github?.directory,
        readOnlyFiles: input.mcp ? [input.mcp.bundle] : [],
        environment: {
          ...launch.environment,
          ...start.credentials?.environmentFor(
            openCodeModelProvider(input.agent.model),
          ),
          ...github?.environment,
        },
        timeoutMs: input.options.timeoutMinutes * 60_000,
        signal: control.signal,
        onLine: (line) => channel.receive(redact(line)),
      });
      requireAcpIsolation(isIsolated, mode, input);
      limited = await this.limit(request, input);
      if (control.signal.aborted) throw new AgentPlanCancelledError();
      child = this.dependencies.runner.startSession(limited.request);
      connectChild(child, channel, {
        observer: control.observer,
        arguments: limited.request.arguments,
        unattended: profile.unattended,
        signal: control.signal,
      });
      return new AcpSession(child, channel.stream, {
        instanceId: input.instanceId,
        driver: pinnedAgentToolDriver(driver, start.adapterVersion),
        profile,
        request: acpSessionRequest(input, {
          ...launch,
          mcpServers: start.browser
            ? [...launch.mcpServers, start.browser]
            : launch.mcpServers,
        }),
        observer: control.observer,
        signal: control.signal,
        isolation: `${isolationLabel(isIsolated, mode, driver)}; ${limited.label}`,
        github: github?.status,
        redact,
        secure: () => this.secureAcp(input, start, github),
        listener: input.chat?.listener ?? input.journal,
        notificationHandled: () => channel.acknowledge(),
      });
    } catch (error: unknown) {
      logCaughtError("CliSessionExecution", error);

      await this.cleanupAcpStart(child, input.instanceId, github, limited);
      throw error;
    }
  }

  private async cleanupAcpStart(
    child: CliSessionProcess | null,
    instanceId: string,
    github: CliGitHubAccess | null,
    limited: LimitedRequest | null,
  ): Promise<void> {
    // A unit that never got its process still has an environment file to remove.
    if (child === null) await limited?.request.unit?.settle();
    const isConfirmed =
      child === null || (await this.closeFailedAcp(child, instanceId));
    try {
      await github?.cleanup();
    } catch (caughtError: unknown) {
      logCaughtError("CliSessionExecution", caughtError);

      if (isConfirmed) throw new AgentError("credential_cleanup_failed");
    }
    if (!isConfirmed) throw new AcpCleanupUnconfirmedError();
  }

  private async closeFailedAcp(
    child: CliSessionProcess,
    instanceId: string,
  ): Promise<boolean> {
    try {
      child.cancel("login_cancelled");
      return (await closeCliSession(child, instanceId)).isConfirmed;
    } catch (caughtError: unknown) {
      logCaughtError("CliSessionExecution", caughtError);

      return false;
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
   * Starts the worker in a limited unit of the service manager.
   *
   * @remarks
   * Pica's conversations never start without one. A plan node starts
   * without it, as before, where the host has no service manager for the
   * server account; one warning says so.
   */
  private async limit(
    request: CliSessionRequest,
    input: AgentPlanSessionInput,
  ): Promise<LimitedRequest> {
    const { units } = this.dependencies;
    if (units && (await units.isAvailable())) {
      const wrapped = await units.wrap(request, input.instanceId);
      return {
        request: { ...wrapped.request, unit: wrapped.unit },
        label: `unit ${wrapped.unit.name}: memory ${ACP_WORKER_LIMITS.memoryMax}, swap ${ACP_WORKER_LIMITS.memorySwapMax}, tasks ${ACP_WORKER_LIMITS.tasksMax}, CPU ${ACP_WORKER_LIMITS.cpuQuota}`,
      };
    }
    if (input.chat) throw new AgentError("acp_worker_unit_unavailable");
    if (!this.hasWarnedWithoutUnits) {
      this.hasWarnedWithoutUnits = true;
      logDiagnostic(
        "CliSessionExecution",
        "warn",
        "Pages runs plan agents without a limited service unit because the service manager of the server account does not start one.",
      );
    }
    return { request, label: "no limited unit" };
  }

  /**
   * Runs in a mount namespace that hides the instance folders, where bubblewrap works.
   *
   * @remarks
   * Where it does not, the session starts as before and one warning says so,
   * unless the operator demanded isolation: then the node fails before any process.
   */
  private async isolate(request: CliSessionRequest): Promise<IsolatedRequest> {
    if (this.isolation === null) {
      if (this.isIsolationRequired)
        throw new AgentError("cli_isolation_unavailable");
      return { request, isIsolated: false };
    }
    const isolated = await this.isolation.isolate(request);
    if (isolated !== null) return { request: isolated, isIsolated: true };
    if (this.isIsolationRequired)
      throw new AgentError("cli_isolation_unavailable");
    if (!this.hasWarnedWithoutIsolation) {
      this.hasWarnedWithoutIsolation = true;
      logDiagnostic(
        "CliSessionExecution",
        "warn",
        "Pages runs CLI agents without a mount namespace because bubblewrap does not work on this host. Install it, or set PAGES_CLI_ISOLATION=required to refuse such runs.",
      );
    }
    return { request, isIsolated: false };
  }
}

/** Lets the session talk to its started adapter and reports the start. */
function connectChild(
  child: CliSessionProcess,
  channel: AcpLineChannel,
  start: {
    readonly observer: PlanSessionObserver;
    readonly arguments: readonly string[];
    readonly unattended: string;
    readonly signal: AbortSignal;
  },
): void {
  channel.attach((line) => child.writeAsync(line));
  const close = (): void => channel.close();
  start.signal.addEventListener("abort", close, { once: true });
  if (start.signal.aborted) close();
  void child.exited.then(() => {
    start.signal.removeEventListener("abort", close);
    channel.close();
  });
  start.observer.started({
    mode: "interactive",
    processId: child.processId,
    startedAt: new Date().toISOString(),
    arguments: start.arguments,
    unattended: start.unattended,
  });
}

/** Every CLI plan runner and native Pica runner uses ACP, without a one-shot fallback. */
function sessionAcpProvider(
  input: AgentPlanSessionInput,
): NativeAcpProviderId | null {
  const provider = input.agent.connection.provider;
  return isAcpProvider(provider) ? provider : null;
}

/** What the ACP session runs; a chat session brings its own MCP bridge and continuation. */
function acpSessionRequest(
  input: AgentPlanSessionInput,
  launch: AcpLaunch,
): AcpSessionRequest {
  return {
    directory: input.directory,
    prompt: input.prompt,
    ticketInputs: input.ticketInputs,
    readTicketAssets: input.readTicketAssets,
    model: input.agent.model,
    modelSupportsImages: input.agent.supportsImages,
    reasoningEffort: input.agent.reasoningEffort,
    mcpServers: input.chat?.mcpServers ?? launch.mcpServers,
    sessionMeta: launch.sessionMeta,
    promptContent: input.promptContent,
    resumeSessionId:
      input.chat?.resumeSessionId ?? input.resumeSessionId ?? null,
  };
}

/** OpenCode, YOLO and Pica's conversations start only inside the namespace. */
function requireAcpIsolation(
  isIsolated: boolean,
  mode: AcpPermissionMode,
  input: AgentPlanSessionInput,
): void {
  if (isIsolated) return;
  if (input.chat || input.agent.connection.provider === "opencode")
    throw new AgentError("cli_isolation_unavailable");
  if (mode === "yolo") throw new AgentError("plan_yolo_isolation_unavailable");
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

function validateSessionStatus(
  input: AgentPlanSessionInput,
  status: CliStatusOutcome,
  signal: AbortSignal,
): void {
  const provider = input.agent.connection.provider;
  if (signal.aborted) throw new AgentPlanCancelledError();
  if (!status.outcome.ok)
    throw new AgentError(
      provider === "opencode" ||
        status.outcome.errorCode === "cli_not_logged_in"
        ? status.outcome.errorCode
        : "plan_step_failed",
    );
  if (
    provider === "opencode" &&
    !status.credentials?.modelProviders.includes(
      openCodeModelProvider(input.agent.model),
    )
  )
    throw new AgentError("plan_model_unavailable");
}
