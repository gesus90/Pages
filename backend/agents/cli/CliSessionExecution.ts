import { agentPlaywrightServer } from "@/backend/service/agents/tools/AgentPlaywrightSession";
import {
  AgentToolPreflightError,
  AgentToolReadinessError,
} from "@/backend/service/agents/tools/AgentToolReadinessError";
import {
  agentToolAdapterVersion,
  prepareAgentToolSession,
  observeAgentToolSession,
  superviseAgentToolSession,
} from "@/backend/service/agents/tools/AgentToolSession";
import { providerToolIds } from "@/backend/service/agents/tools/AgentToolRegistry";
import { acpDriverFor } from "@/backend/agents/acp/AcpDrivers";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { effectiveAgentAccess } from "@/definition/AgentAccessMode";
import {
  isAcpPermissionMode,
  nativeAcpProvider,
} from "@/definition/AgentConfiguration";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import {
  mergeHostMcpServers,
  readsHostMcpConfiguration,
} from "./CliHostMcpServers";
import { nativeHostRequest, readNativeHost } from "./CliNativeHost";
import {
  describeOpenCodeAgent,
  openCodeAgentObserver,
} from "./OpenCodeAgentModel";
import { connectChild } from "./CliSessionChannel";
import {
  assetSession,
  sessionAssetWorkspace,
  prepareSessionAssets,
  cleanupSessionAssets,
} from "./CliAssetWorkspace";
import { CliIsolationGate } from "./CliIsolationGate";
import { attachPlanTemporaryDirectory } from "./CliPlanTemporaryDirectory";
import { CliPlanIsolation } from "./CliPlanIsolation";
import { ACP_WORKER_LIMITS } from "./CliWorkerUnit";
import { cleanupFailedAcpStart } from "./CliAcpStartCleanup";
import { acpWorkerRequest } from "./CliAcpLaunch";
import { prepareSharedAgentEnvironment } from "./AgentSharedEnvironment";
import { redactAcpJsonLine } from "./CliAcpRedaction";
import { prepareAcpProtocol } from "./CliAcpProtocol";
import { requireAcpIsolation, sessionRunOptionError } from "./CliSessionPlans";
import {
  readConnectionStatus,
  recordGitHubNamespace,
  requireAcpMode,
  requireAdapter,
  sessionAcpProvider,
  sessionContainment,
  validateSessionStatus,
} from "./CliSessionChecks";
import {
  openCliAcpSession,
  prepareCliGitHubAccess,
  prepareScopedClaudeHome,
  preparePicaSession,
  registerAcpNamespace,
  secureCliAcpAccess,
} from "./CliAcpSessionSetup";

import type { VerifiedStart } from "./CliSessionChecks";
import type { HostMcpDiscovery } from "./CliHostMcpServers";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
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
import type { ClaudeQuotaRecorder } from "@/backend/service/agents/ClaudeQuotaRecorder";
import type { AgentCliRuntime } from "./AgentCliRuntime";
import type { AgentCredentialStore } from "./AgentCredentialStore";
import type {
  CliHome,
  CliCredentialAccess,
  CliSessionRequest,
} from "./CliContracts";
import type { CliLocator } from "./CliLocator";
import type { CliProcessRunner } from "./CliProcessRunner";
import type {
  CliGitHubAccess,
  CliGitHubCredentials,
} from "./CliGitHubCredentials";
import type {
  ClaudePlanSessionHome,
  prepareClaudePlanSessionHome,
} from "./ClaudePlanSessionHome";
import type { CliSessionContainment } from "./CliSessionCloseout";
import type { CliSessionProcess } from "./CliSessionProcess";
import type { AcpStartLifecycle } from "@/backend/service/agents/resources/AcpStartLifecycle";
import type { CliWorkerUnits } from "./CliWorkerUnit";
import type { PicaCodexBundle } from "./PicaCodexBundle";
import type {
  LimitedRequest,
  OpenCliAcpSessionContext,
  SessionControl,
} from "./CliAcpSessionSetup";

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
  readonly apiCredentials?: (
    connection: AgentPlanSessionInput["agent"]["connection"],
  ) => Promise<CliCredentialAccess>;
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
  /** Prepares the private transcript home of a Claude plan session; defaults to the real folders. */
  readonly claudeHome?: typeof prepareClaudePlanSessionHome;
  /**
   * The MCP servers configured on the host for the CLI of a provider; a YOLO
   * plan node receives them like a YOLO chat, absent passes none.
   */
  readonly hostMcp?: HostMcpDiscovery;
  /** Stores the subscription figures Claude sessions report; absent stores none. */
  readonly claudeQuota?: Pick<ClaudeQuotaRecorder, "sinkFor">;
}

/**
 * Starts the CLI sessions of plan nodes in their authorized workspaces.
 * @remarks
 * Every session uses the credential folder of its connection, the exact model
 * and effort of the agent and only managed switches. The local sign-in is
 * checked and the executor is authorized again right before the process
 * starts; the prompt and every credential stay out of the argument list.
 * Codex, Claude Code and OpenCode run as ACP sessions, each in
 * one of its two modes; there is no fallback to another runner. Plan nodes,
 * swarm sessions and the sessions of agent employees all start here, so
 * "Lesend" and YOLO mean the same wherever an agent runs.
 */
export class CliSessionExecution implements PlanSessionRunner {
  private readonly dependencies: SessionDependencies;
  private readonly gate: CliIsolationGate;
  private hasWarnedWithoutUnits = false;

  public constructor(dependencies: SessionDependencies) {
    this.dependencies = dependencies;
    const { isolation } = dependencies;
    this.gate = new CliIsolationGate(
      isolation
        ? new CliPlanIsolation(
            isolation.protectedDirectories,
            isolation.probe,
            isolation,
          )
        : null,
      dependencies.tools !== undefined || isolation?.isRequired === true,
    );
  }

  /**
   * Starts the session of one node; the returned session is already running.
   * @throws {AgentError} `plan_run_option_unsupported` or
   * `codex_permission_mode_required` for options the runner cannot enforce,
   * `cli_not_logged_in` without a confirmed sign-in, the missing-adapter code
   * of the runner or `plan_codex_configuration_unmanaged` before an ACP
   * session, `agent_native_host_unavailable` or `acp_worker_unit_unavailable`
   * for a YOLO session whose host or process ownership cannot be confirmed,
   * or a start failure; {@link AgentPlanCancelledError} after a stop.
   */
  public async open(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession> {
    const recoveryRunId = input.resourceContext?.recoveryRunId;
    if (recoveryRunId)
      await this.dependencies.resources?.releaseForResume(recoveryRunId);
    const provider = sessionAcpProvider(input);
    if (provider !== null && this.dependencies.resources)
      return this.dependencies.resources.openWithin({
        owner: {
          instanceId: input.instanceId,
          userId: input.userId,
          provider,
          runId: input.resourceContext?.runId ?? null,
          stepId: input.resourceContext?.stepId ?? null,
        },
        signal,
        start: (admitted, lifecycle) => {
          lifecycle.trackSpawn();
          return this.openAdmitted(input, admitted, observer, lifecycle);
        },
        observer,
        deadlineMs: input.resourceContext?.admissionDeadlineMs,
      });
    return this.openAdmitted(input, signal, observer);
  }

  private async openAdmitted(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
    lifecycle?: AcpStartLifecycle,
  ): Promise<PlanSession> {
    const { tools } = this.dependencies;
    const locations = tools
      ? await prepareAgentToolSession({
          manager: tools,
          request: input,
          signal,
        }).catch((error: unknown) => {
          if (error instanceof AgentToolReadinessError)
            throw new AgentToolPreflightError(error);
          throw error;
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
        lifecycle,
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
      const provider = nativeAcpProvider(input.agent.connection.provider);
      if (hasVerified && provider !== null)
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
    const { id } = input.agent.connection;
    const provider = sessionAcpProvider(input);
    if (provider === null) throw new AgentError("provider_invalid");
    const unsupported = sessionRunOptionError(input);
    if (unsupported !== null) throw new AgentError(unsupported);
    const { store, locator } = this.dependencies;
    const home = await store.prepare(id, provider);
    try {
      if (home.sharedEnvironment)
        await prepareSharedAgentEnvironment(home.sharedEnvironment);
      const pinned = locations?.get(providerToolIds(provider)[0])?.file;
      const status = await readConnectionStatus(this.dependencies, input, {
        home,
        signal,
        file: pinned,
      });
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
      const adapterVersion = agentToolAdapterVersion(provider, locations);
      return {
        ...(await this.optionalStartParts(input, signal, locations)),
        provider,
        home,
        file: location.path,
        adapter: acpAdapter,
        adapterVersion,
        credentials: status.credentials,
      };
    } catch (error: unknown) {
      logCaughtError("CliSessionExecution", error);

      await store.secure(id, provider);
      throw error;
    }
  }

  /** Resolves the native host and the browser server a session may add, in the original order. */
  private async optionalStartParts(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    locations?: ReadonlyMap<AgentToolId, AgentToolLocation>,
  ): Promise<Pick<VerifiedStart, "host" | "browser">> {
    const host =
      input.options.access === "read_only"
        ? undefined
        : await readNativeHost(input.directory, signal);
    return {
      ...(host ? { host } : {}),
      browser: locations ? await agentPlaywrightServer(input, locations) : null,
    };
  }

  /**
   * Finds the adapter and, in "Lesend", refuses configuration files Pages does not manage.
   * @remarks
   * Such a file could widen a reading session. YOLO uses the configuration
   * of the host and of the workspace as it is.
   */
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
    if (input.options.access === "read_only")
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
   * @remarks
   * "Lesend" runs inside the read-only namespace, which mounts the whole host
   * read-only and hides only the instance folders of Pages. YOLO runs as a
   * native process of the account, with its real home, its login PATH and
   * the MCP servers configured on the host, framed only by its worker unit,
   * which confirms its process ownership and ends every child.
   */
  private async spawnAcp(
    driver: AcpDriver,
    input: AgentPlanSessionInput,
    start: VerifiedStart,
    control: SessionControl,
  ): Promise<PlanSession> {
    const { mode, scoped, adapter, github, protocol } =
      await this.prepareAcpStart(driver, input, start);
    const { profile, channel, redact } = protocol;
    const launch = await this.withHostMcpServers(protocol.launch, input, mode);
    let child: CliSessionProcess | null = null;
    let limited: LimitedRequest | null = null;
    let containment: CliSessionContainment = "none";
    let picaBundle: PicaCodexBundle | null = null;
    try {
      const pica = await preparePicaSession({
        driver,
        input,
        launch,
        profile,
        tools: this.dependencies.tools,
        adapter,
        adapterVersion: start.adapterVersion,
      });
      const { picaNative } = pica;
      picaBundle = pica.picaBundle;
      const { request, isIsolated } = await this.isolateWorker(
        acpWorkerRequest({
          driver,
          input,
          mode,
          launch,
          adapter,
          provider: start.provider,
          home: start.home,
          credentials: start.credentials,
          github,
          picaNative,
          picaBundle,
          signal: control.signal,
          onLine: (line) =>
            channel.receive(
              start.host ? redactAcpJsonLine(line, redact) : redact(line),
            ),
        }),
        scoped,
        input,
        start,
      );
      limited = await this.limit(request, input);
      containment = sessionContainment(isIsolated, limited.request);
      if (control.signal.aborted) throw new AgentPlanCancelledError();
      if (start.host) await input.beforeStart?.();
      await control.lifecycle?.beforeSpawn(limited.request.unit?.name);
      child = this.dependencies.runner.startSession(limited.request);
      return await this.attachAcpSession({
        child,
        channel,
        driver,
        input,
        start,
        control: {
          ...control,
          observer: openCodeAgentObserver(input, control.observer),
        },
        profile,
        launch,
        picaNative,
        picaBundle,
        picaSupport: pica.picaSupport,
        isIsolated,
        mode,
        limited,
        containment,
        github,
        redact: (text) => describeOpenCodeAgent(input, redact(text)),
      });
    } catch (error: unknown) {
      logCaughtError("CliSessionExecution", error);

      await this.abortFailedStart(
        child,
        { instanceId: input.instanceId, github, limited, containment },
        picaBundle,
        control,
      );
      throw error;
    }
  }

  /** Ends an unsuccessful ACP start; its own closeout confirmed the frame ended, so the reservation may go. */
  private async abortFailedStart(
    child: CliSessionProcess | null,
    cleanup: {
      readonly instanceId: string;
      readonly github: CliGitHubAccess | null;
      readonly limited: LimitedRequest | null;
      readonly containment: CliSessionContainment;
    },
    picaBundle: PicaCodexBundle | null,
    control: SessionControl,
  ): Promise<void> {
    await cleanupFailedAcpStart(child, cleanup, picaBundle?.cleanup);
    control.lifecycle?.confirmStartEnded();
  }

  /** Verifies the mode, home and adapter facts every worker spawn shares. */
  private async prepareAcpStart(
    driver: AcpDriver,
    input: AgentPlanSessionInput,
    start: VerifiedStart,
  ): Promise<{
    readonly mode: AcpPermissionMode;
    readonly scoped: ClaudePlanSessionHome | null;
    readonly adapter: string;
    readonly github: CliGitHubAccess | null;
    readonly protocol: ReturnType<typeof prepareAcpProtocol>;
  }> {
    const mode = requireAcpMode(driver, input);
    // A native session has no namespace that could hold a private transcript home.
    const scoped = start.host
      ? null
      : await prepareScopedClaudeHome(
          driver,
          input,
          start,
          this.dependencies.claudeHome,
        );
    const adapter = requireAdapter(start.adapter, driver);
    const github = await prepareCliGitHubAccess(
      this.dependencies,
      input,
      start,
      mode,
    );
    return {
      mode,
      scoped,
      adapter,
      github,
      protocol: prepareAcpProtocol(driver, input, start, github),
    };
  }

  private async attachAcpSession(
    context: Omit<OpenCliAcpSessionContext, "secure" | "claudeQuota">,
  ): Promise<PlanSession> {
    const namespace = await registerAcpNamespace({
      resources: this.dependencies.resources,
      input: context.input,
      processId: context.child.processId,
      request: context.limited.request,
      containment: context.containment,
    });
    await recordGitHubNamespace(context.github, namespace);
    connectChild(context.child, context.channel, {
      observer: context.control.observer,
      arguments: context.limited.request.arguments,
      unattended: context.profile.unattended,
      signal: context.control.signal,
      namespace,
    });
    return openCliAcpSession({
      ...context,
      claudeQuota:
        context.driver.provider === "claude_code"
          ? this.dependencies.claudeQuota?.sinkFor(
              context.input.agent.connection.id,
            )
          : undefined,
      secure: () =>
        secureCliAcpAccess(
          this.dependencies.store,
          context.input,
          context.start,
          context.github,
        ),
    });
  }

  /**
   * Gives a YOLO plan session the MCP servers configured on the host.
   * @remarks
   * A chat brings its own servers, the host's among them, so only a plan or
   * swarm session reads them here. The Pages servers of the launch keep
   * their place; a host server of the same name is left out.
   */
  private async withHostMcpServers(
    launch: ReturnType<typeof prepareAcpProtocol>["launch"],
    input: AgentPlanSessionInput,
    mode: AcpPermissionMode,
  ): Promise<ReturnType<typeof prepareAcpProtocol>["launch"]> {
    const { hostMcp } = this.dependencies;
    if (
      !hostMcp ||
      input.chat ||
      input.purpose === "decision" ||
      input.purpose === "observer" ||
      !effectiveAgentAccess(mode).hostMcpServers ||
      readsHostMcpConfiguration(input.agent.connection.provider)
    )
      return launch;
    const servers = await hostMcp.servers(input.agent.connection.provider);
    return {
      ...launch,
      mcpServers: mergeHostMcpServers(
        launch.mcpServers,
        servers.map((entry) => entry.server),
      ),
    };
  }

  /**
   * Starts a YOLO worker natively, or wraps a "Lesend" worker in the read-only namespace.
   * @remarks
   * YOLO never runs in bubblewrap and does not need it installed. "Lesend"
   * keeps the rules of {@link requireAcpIsolation}.
   */
  private async isolateWorker(
    worker: CliSessionRequest,
    scoped: ClaudePlanSessionHome | null,
    input: AgentPlanSessionInput,
    start: VerifiedStart,
  ): Promise<{
    readonly request: CliSessionRequest;
    readonly isIsolated: boolean;
  }> {
    const mode = input.options.access;
    const attached = await attachPlanTemporaryDirectory(worker, input);
    if (start.host)
      return {
        request: nativeHostRequest(attached, start.host),
        isIsolated: false,
      };
    const isolated = await this.gate.isolateSession(attached, scoped);
    if (isAcpPermissionMode(mode))
      requireAcpIsolation(isolated.isIsolated, mode, input);
    return isolated;
  }

  /**
   * Starts the worker in a limited unit of the service manager.
   * @remarks
   * Pica's conversations and every YOLO session never start without one: a
   * native process has no namespace, so only the unit confirms its process
   * ownership, ends its children and stdio MCP servers and proves their end.
   * A "Lesend" plan node starts without it, as before, where the host has no
   * service manager for the server account; one warning says so.
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
        label: `unit ${wrapped.unit.name}: memory ${ACP_WORKER_LIMITS.memoryMax}, swap ${ACP_WORKER_LIMITS.memorySwapMax}, tasks ${ACP_WORKER_LIMITS.tasksMax}, CPU ${ACP_WORKER_LIMITS.cpuQuota}, OOM score ${ACP_WORKER_LIMITS.oomScoreAdjust}`,
      };
    }
    if (input.chat || input.options.access !== "read_only")
      throw new AgentError("acp_worker_unit_unavailable");
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
}
