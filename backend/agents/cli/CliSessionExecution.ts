import { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import {
  CODEX_ACP_BINARY,
  planCodexAcpLaunch,
} from "@/backend/agents/acp/CodexAcpAdapter";
import { findUnmanagedCodexConfiguration } from "@/backend/agents/acp/CodexAcpConfigurationGuard";
import { codexAcpProfile } from "@/backend/agents/acp/CodexAcpProfile";
import { CodexAcpSession } from "@/backend/agents/acp/CodexAcpSession";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { isCodexPermissionMode } from "@/definition/AgentConfiguration";
import { isApiProvider } from "@/definition/AgentConnection";

import { CliPlanIsolation } from "./CliPlanIsolation";
import { CliPlanSession } from "./CliPlanSession";
import { createCliSessionState } from "./CliSessionEvents";
import { planCliSession, unsupportedRunOption } from "./CliSessionPlans";

import type {
  AgentPlanSessionInput,
  PlanSession,
  PlanSessionObserver,
  PlanSessionRunner,
} from "@/backend/agents/AgentPlanExecution";
import type { CodexPermissionMode } from "@/definition/AgentConfiguration";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { AgentCliRuntime } from "./AgentCliRuntime";
import type { AgentCredentialStore } from "./AgentCredentialStore";
import type { CliHome, CliSessionRequest } from "./CliContracts";
import type { CliLocator } from "./CliLocator";
import type { CliProcessRunner } from "./CliProcessRunner";

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
  readonly runtime: AgentCliRuntime;
  readonly store: AgentCredentialStore;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
  /** Absent disables the isolation. */
  readonly isolation?: CliIsolationOptions;
}

/** What a session start has verified about its connection. */
interface VerifiedStart {
  readonly provider: CliProviderId;
  readonly home: CliHome;
  readonly file: string;
  /** The Codex ACP adapter; `null` for the runners without ACP. */
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
 * Codex runs as an ACP session through its adapter, in one of its two modes;
 * there is no fallback to another runner.
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
   * `cli_not_logged_in` without a confirmed sign-in, `plan_acp_adapter_missing`
   * or `plan_codex_configuration_unmanaged` before a Codex session,
   * `plan_permission_mode_unenforceable` for YOLO without the namespace, or a
   * start failure; {@link AgentPlanCancelledError} after a stop.
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
      const acpAdapter =
        provider === "codex_cli" ? await this.verifyAcp(input, home) : null;
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
    input: AgentPlanSessionInput,
    home: CliHome,
  ): Promise<string> {
    const location = await this.dependencies.locator.locate(CODEX_ACP_BINARY);
    if (!location.path) throw new AgentError("plan_acp_adapter_missing");
    const unmanaged = await findUnmanagedCodexConfiguration(
      home.config,
      input.directory,
    );
    if (unmanaged !== null) {
      console.warn(
        `Pages refused a Codex plan node because of ${unmanaged}, a Codex configuration file that Pages does not manage.`,
      );
      throw new AgentError("plan_codex_configuration_unmanaged");
    }
    return location.path;
  }

  private async spawn(
    input: AgentPlanSessionInput,
    start: VerifiedStart,
    control: SessionControl,
  ): Promise<PlanSession> {
    if (start.provider === "codex_cli")
      return this.spawnAcp(input, start, control);
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
   * Starts the Codex ACP adapter and its session in the stored mode.
   *
   * @remarks
   * "Nur Lesen" also gets its working copy read-only in the namespace. YOLO
   * runs Codex without a sandbox of its own, so only the namespace keeps it
   * inside its workspace and away from the instance folders and other
   * credentials; without the namespace YOLO does not start.
   */
  private async spawnAcp(
    input: AgentPlanSessionInput,
    start: VerifiedStart,
    control: SessionControl,
  ): Promise<PlanSession> {
    const mode = input.options.access;
    if (!isCodexPermissionMode(mode))
      throw new AgentError("codex_permission_mode_required");
    if (start.adapter === null)
      throw new AgentError("plan_acp_adapter_missing");
    const profile = codexAcpProfile(mode);
    const launch = planCodexAcpLaunch({
      instanceId: input.instanceId,
      codexFile: start.file,
      profile,
      mcp: input.mcp,
    });
    const channel = new AcpLineChannel();
    const { request, isIsolated } = await this.isolate({
      file: start.adapter,
      provider: start.provider,
      home: start.home,
      arguments: [],
      workingDirectory: input.directory,
      isWorkingDirectoryReadOnly: mode === "read_only",
      environment: launch.environment,
      timeoutMs: input.options.timeoutMinutes * 60_000,
      signal: control.signal,
      onLine: (line) => channel.receive(line),
    });
    if (mode === "yolo" && !isIsolated)
      throw new AgentError("plan_permission_mode_unenforceable");
    const child = this.dependencies.runner.startSession(request);
    channel.attach((line) => child.write(line));
    void child.exited.then(() => channel.close());
    control.observer.started({
      mode: "interactive",
      processId: child.processId,
      startedAt: new Date().toISOString(),
      arguments: request.arguments,
      unattended: profile.unattended,
    });
    return new CodexAcpSession(child, channel.stream, {
      instanceId: input.instanceId,
      profile,
      request: {
        directory: input.directory,
        prompt: input.prompt,
        model: input.agent.model,
        reasoningEffort: input.agent.reasoningEffort,
        mcpServers: launch.mcpServers,
        sessionMeta: launch.sessionMeta,
      },
      observer: control.observer,
      signal: control.signal,
      isolation: isolationLabel(isIsolated, mode),
      secure: () =>
        this.dependencies.store.secure(
          input.agent.connection.id,
          start.provider,
        ),
    });
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
  mode: CodexPermissionMode,
): string {
  if (!isIsolated) return "none, the Codex sandbox only";
  return mode === "read_only"
    ? "bubblewrap, workspace read-only"
    : "bubblewrap";
}
