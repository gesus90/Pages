import { AgentError } from "@/backend/error/AgentErrors";
import { requireAgentAdministrator } from "@/backend/service/agents/AgentServiceAccess";

import {
  AgentToolCombinations,
  agentToolCombination,
  resolvePublishedCombination,
} from "./AgentToolCombinations";
import {
  AgentToolExclusiveQueue,
  agentToolDependencyClosure,
  inspectAgentTool,
  publishedAgentToolLocation,
  rollbackAgentTool,
  runAgentToolStartupInventory,
} from "./AgentToolInventory";
import { AgentToolOperationLog } from "./AgentToolOperationLog";
import {
  AGENT_TOOL_REGISTRY,
  agentToolDefinition,
  providerToolIds,
  isAgentToolInstallable,
  isAgentToolVersionSupported,
} from "./AgentToolRegistry";
import { AgentToolReadinessError } from "./AgentToolReadinessError";
import { AgentRuntimeSupervisor } from "./AgentRuntimeSupervisor";
import { bindManagedNode } from "./AgentToolRuntimePaths";
import { AgentToolStates, UNCHECKED_TOOL_STATE } from "./AgentToolStates";
import {
  agentToolUpdateView,
  requireUpdateTarget,
} from "./AgentToolUpdateJobs";
import {
  agentToolFailureDiagnostic,
  agentToolView,
  mergeAgentToolActivities,
} from "./AgentToolViews";

import type {
  CliToolLocation,
  CliProviderId,
} from "@/definition/AgentConnection";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentToolActivity,
  AgentToolAction,
  AgentToolConnectionView,
  AgentToolDiagnostic,
  AgentToolId,
  AgentToolView,
} from "@/definition/AgentTools";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type {
  AgentToolHealthChecks,
  AgentToolInstallation,
  AgentToolLocation,
  AgentToolStorage,
} from "./AgentToolContracts";
import type {
  AgentToolInventoryScope,
  AgentToolQueueMode,
} from "./AgentToolInventory";
import type { AgentToolUpdateSearch } from "./AgentToolUpdateSearch";

interface ManagerDependencies {
  readonly activities?: (id: AgentToolId) => readonly AgentToolActivity[];
  readonly files: AgentToolStorage;
  readonly installer: AgentToolInstallation;
  readonly health: AgentToolHealthChecks;
  readonly updates: AgentToolUpdateSearch;
  readonly system: (
    tool: AgentToolDefinition,
  ) => Promise<AgentToolLocation | null>;
}

/** Central fixed-registry readiness, installation, repair, update and rollback coordination. */
export class AgentToolManagerService {
  public readonly supervisor = new AgentRuntimeSupervisor();
  private readonly dependencies: ManagerDependencies;
  private readonly authentication = new Map<
    string,
    { readonly tool: AgentToolId; readonly isReady: boolean }
  >();
  private readonly states = new AgentToolStates((id, state) => {
    if (id === "node") bindManagedNode(state);
  });
  private readonly operations: AgentToolOperationLog;
  private readonly combinations: AgentToolCombinations;
  private readonly connections = new Map<
    AgentToolId,
    readonly AgentToolConnectionView[]
  >();
  private readonly queue = new AgentToolExclusiveQueue();
  private readonly shutdownController = new AbortController();
  private readonly requested = new Set<AgentToolId>();
  private readonly startupTools = new Set<AgentToolId>(["node", "bubblewrap"]);
  private readonly startupProbes = new Map<AgentToolId, "inspect" | "ensure">();
  private initialized: Promise<void> | null = null;
  private inventory: Promise<void> | null = null;
  private settingsFailure = false;
  private settingsQueue: Promise<void> = Promise.resolve();

  public constructor(dependencies: ManagerDependencies) {
    this.dependencies = dependencies;
    const { files } = dependencies;
    this.operations = new AgentToolOperationLog(
      files.saveOperation?.bind(files) ?? null,
    );
    this.combinations = new AgentToolCombinations({
      files: dependencies.files,
      installer: dependencies.installer,
      health: dependencies.health,
      updates: dependencies.updates,
      operations: this.operations,
      states: this.states,
      signal: this.shutdownController.signal,
      inspect: (id) => this.inspect(id),
      ready: (id) => this.ready(id),
      dependenciesReady: (tool) => this.dependenciesReady(tool),
      exclusive: (id, operation, mustRun) =>
        this.exclusive(id, operation, mustRun ? "manage" : "ensure"),
      published: (tool, location) =>
        publishedAgentToolLocation(dependencies.files, tool, location),
    });
  }

  /** Instance-local directory mounted read-only for every native session. */
  public get directory(): string {
    return this.dependencies.files.root;
  }

  /** Shared release search used by manual admin checks and the daily background schedule. */
  public get updateSearch(): AgentToolUpdateSearch {
    return this.dependencies.updates;
  }

  /** Collects obsolete releases only while no installation, probe or native session uses the tool. */
  public async runMaintenance(): Promise<void> {
    for (const tool of AGENT_TOOL_REGISTRY) {
      if (this.queue.has(tool.id)) continue;
      await this.exclusive(tool.id, async () => {
        if (
          this.supervisor.activities(tool.id).length > 0 ||
          (this.dependencies.activities?.(tool.id).length ?? 0) > 0
        )
          return;
        await this.dependencies.files.prune?.(tool);
      });
    }
  }

  /** Returns cached secret-free metadata after checking active system administrator rights. */
  public list(actor: AccountAccess): readonly AgentToolView[] {
    requireAgentAdministrator(actor);
    const enabled = this.enabled();
    return AGENT_TOOL_REGISTRY.map((tool) =>
      this.view(tool, enabled.has(tool.id)),
    );
  }

  /**
   * Restores the kept tool settings and starts the tool inventory in the background.
   * @param providers - The CLI providers of active connections; their tools are made ready.
   * @param scope - `all` also inspects the tools that are not enabled, for the Tools page.
   * @remarks
   * Only reading the kept settings is awaited, so service readiness, a session
   * start and the Tools page never wait for a slow probe; each finished probe
   * updates the cached state {@link list} returns.
   */
  public async start(
    providers: readonly CliProviderId[] = [],
    scope: AgentToolInventoryScope = "enabled",
  ): Promise<void> {
    for (const provider of providers)
      for (const id of providerToolIds(provider)) this.startupTools.add(id);
    this.initialized ??= this.restorePersisted();
    await this.initialized;
    this.launchStartupInventory(scope);
  }

  /** Resolves once the startup inventory begun so far ended; it never rejects. */
  public whenInventoryReady(): Promise<void> {
    return this.inventory ?? Promise.resolve();
  }

  /** Persists explicit optional integration access; enabled connection prerequisites remain required. */
  public async setEnabled(
    actor: AccountAccess,
    id: AgentToolId,
    enabled: boolean,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    await this.start();
    const change = this.settingsQueue.then(async () => {
      if (this.settingsFailure)
        throw new AgentToolReadinessError(id, "failed", "settings_unavailable");
      const next = new Set(this.requested);
      if (enabled) next.add(id);
      else next.delete(id);
      await this.dependencies.files.writeEnabled([...next]);
      this.requested.clear();
      for (const toolId of next) this.requested.add(toolId);
    });
    this.settingsQueue = change.catch(() => undefined);
    await change;
    if (enabled) {
      await this.ensureTool(id);
      if (id === "playwright_mcp") await this.ensureTool("chromium");
    }
  }

  /** Performs only a fixed registry operation; removal refuses every pinned dependent session. */
  public async manage(
    actor: AccountAccess,
    id: AgentToolId,
    action: AgentToolAction,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    await this.start();
    this.dependencies.health.forget?.(id);
    if (action === "rebind") throw new AgentError("configuration_invalid");
    const tool = agentToolDefinition(id);
    if (tool.release && ["update", "rollback", "install"].includes(action)) {
      await this.combinations.change(id, action);
      return;
    }
    await this.exclusive(
      id,
      async () => {
        if (action === "remove") {
          await this.remove(id);
          return;
        }
        if (action === "rollback") {
          await this.rollback(id);
          return;
        }
        await this.dependenciesReady(tool);
        if (action === "check" || action === "test") {
          await this.inspect(id);
          return;
        }
        if (action === "install") {
          await this.ready(id);
          return;
        }
        await this.inspect(id);
        const current = this.states.get(id);
        if (
          action === "update" &&
          current?.health.status === "ready" &&
          current.health.version === tool.version
        )
          return;
        await this.install(id, action === "update" ? "updating" : "repairing");
      },
      "manage",
    );
  }

  /**
   * Reads release metadata of every fixed official source.
   * @remarks
   * Nothing is installed or activated; a later update installs what the
   * search chose. An unreachable source is reported as such.
   */
  public async checkUpdates(actor: AccountAccess): Promise<void> {
    requireAgentAdministrator(actor);
    await this.start();
    await this.dependencies.updates.search(this.shutdownController.signal);
  }

  /**
   * Accepts an update only for the target its page showed and shows it as running at once.
   * @throws {AgentToolReadinessError} `target_changed` or the reason no update can start.
   */
  public acceptUpdate(id: AgentToolId, expected: string | null): void {
    requireUpdateTarget(this.view(agentToolDefinition(id), false), expected);
    this.operations.start(agentToolCombination(id).ids, "update", "resolving");
  }

  /** Keeps the secret-free result of re-binding the connections that use a tool. */
  public recordConnections(
    id: AgentToolId,
    connections: readonly AgentToolConnectionView[],
  ): void {
    for (const toolId of agentToolCombination(id).ids)
      this.connections.set(toolId, connections);
  }

  /** Records a phase of a re-binding in the tool's operation log. */
  public recordRebinding(
    id: AgentToolId,
    state: "running" | "succeeded" | "failed",
  ): void {
    const { ids } = agentToolCombination(id);
    if (state === "running") this.operations.start(ids, "rebind", "rebinding");
    else if (state === "succeeded") this.operations.succeed(ids);
    else this.operations.fail(ids, "execution_failed", "rebind");
  }

  /** Records only a local sign-in result, never credential contents or an account label. */
  public recordAuthentication(
    connectionId: string,
    provider: CliProviderId,
    isReady: boolean,
  ): void {
    this.authentication.set(connectionId, {
      tool: providerToolIds(provider)[0],
      isReady,
    });
  }

  /** Resolves the activated managed generation before looking for a compatible system tool. */
  public async locate(binary: string): Promise<CliToolLocation | null> {
    const tool = AGENT_TOOL_REGISTRY.find((entry) => entry.binary === binary);
    if (!tool) return null;
    const location =
      this.states.get(tool.id)?.location ??
      (await this.dependencies.files.current(tool));
    return location ? { found: true, path: location.file } : null;
  }

  /** Installs provider prerequisites and returns the verified CLI that login, status, catalog and test calls start. */
  public async ensureProvider(
    provider: CliProviderId,
  ): Promise<AgentToolLocation> {
    await this.start();
    return this.ensureTool(providerToolIds(provider)[0]);
  }

  /** Verifies a fixed dependency graph and repairs missing/broken managed tools idempotently. */
  public async ensureTool(id: AgentToolId): Promise<AgentToolLocation> {
    await this.exclusive(id, async () => {
      await this.dependenciesReady(agentToolDefinition(id));
      await this.ready(id);
    });
    const state = this.states.get(id);
    if (!state?.location || state.health.status !== "ready")
      throw this.refusal(id);
    return state.location;
  }

  /** Returns a verified location to probes/installers without starting another readiness operation. */
  public async resolved(id: AgentToolId): Promise<AgentToolLocation | null> {
    return (
      this.states.get(id)?.location ??
      (await this.dependencies.files.current(agentToolDefinition(id)))
    );
  }

  /** Reads the retained managed release without activating it. */
  public async retained(id: AgentToolId): Promise<AgentToolLocation | null> {
    return this.dependencies.files.previous(agentToolDefinition(id));
  }

  /**
   * Used by the shared execution path before a native node can start.
   * @remarks
   * A native YOLO session needs no bubblewrap, so a host without it still
   * starts YOLO; the browser keeps it as its own dependency.
   */
  public async ensureReady(input: {
    readonly provider: CliProviderId;
    readonly browser: boolean;
    readonly instanceId: string;
    /** Whether the session runs natively on the host, as YOLO does. */
    readonly isNative?: boolean;
  }): Promise<ReadonlyMap<AgentToolId, AgentToolLocation>> {
    await this.start();
    if (input.browser && !this.enabled().has("playwright_mcp"))
      throw new AgentToolReadinessError(
        "playwright_mcp",
        "missing_dependency",
        "disabled",
      );
    const ids: AgentToolId[] = [
      "node",
      ...(input.isNative === true ? [] : ["bubblewrap" as const]),
      ...providerToolIds(input.provider),
      ...(input.browser ? ["chromium" as const] : []),
    ];
    const required = agentToolDependencyClosure(ids);
    this.supervisor.reserve(input.instanceId, [...required]);
    try {
      return await resolvePublishedCombination(
        this.dependencies.files,
        required,
        (id) => this.ensureTool(id),
      );
    } catch (error: unknown) {
      this.supervisor.release(input.instanceId);
      throw error;
    }
  }

  /** Cancels bounded installer/probe children through the existing runner before server exit. */
  public async shutdown(): Promise<void> {
    this.shutdownController.abort();
    await Promise.allSettled([
      this.inventory ?? Promise.resolve(),
      ...this.queue.values(),
    ]);
    await this.settingsQueue;
  }

  private async restorePersisted(): Promise<void> {
    const { files, updates } = this.dependencies;
    try {
      await files.initialize?.();
      for (const id of await files.readEnabled()) this.requested.add(id);
      await this.operations.restore(files);
      await updates.restore();
    } catch {
      this.settingsFailure = true;
      for (const tool of AGENT_TOOL_REGISTRY)
        this.fail(tool.id, "settings_unavailable");
      console.warn(
        "[pages] Agent tool settings cannot be read; managed installation is blocked.",
      );
    }
  }

  // A start probes each tool once; a tool enabled after its inspection is made ready behind it.
  private launchStartupInventory(scope: AgentToolInventoryScope): void {
    if (this.settingsFailure || this.shutdownController.signal.aborted) return;
    const enabled = this.enabled();
    const tools: AgentToolDefinition[] = [];
    for (const tool of AGENT_TOOL_REGISTRY) {
      const mode = enabled.has(tool.id) ? "ensure" : "inspect";
      const taken = this.startupProbes.get(tool.id);
      if (taken === "ensure" || taken === mode) continue;
      if (mode === "inspect" && scope === "enabled") continue;
      this.startupProbes.set(tool.id, mode);
      tools.push(tool);
    }
    if (tools.length === 0) return;
    this.inventory = (this.inventory ?? Promise.resolve()).then(() =>
      runAgentToolStartupInventory({
        tools,
        enabled,
        states: this.states,
        files: this.dependencies.files,
        signal: this.shutdownController.signal,
        ensure: (id) => this.ensureStartupTool(id),
        inspect: (id) => this.inspectStartupTool(id),
      }),
    );
  }

  private async ensureStartupTool(id: AgentToolId): Promise<void> {
    try {
      await this.ensureTool(id);
    } catch {
      console.warn(
        `[pages] Agent tool ${id} is unavailable (${this.states.get(id)?.health.diagnostic ?? "dependency_failed"}).`,
      );
    }
  }

  private async inspectStartupTool(id: AgentToolId): Promise<void> {
    try {
      await this.exclusive(id, () => this.inspect(id), "inspect");
    } catch {
      console.warn(
        `[pages] Agent tool ${id} could not be inspected (${this.states.get(id)?.health.diagnostic ?? "execution_failed"}).`,
      );
    }
  }

  private enabled(): Set<AgentToolId> {
    return agentToolDependencyClosure([
      ...this.startupTools,
      ...this.requested,
      ...(this.requested.has("playwright_mcp") ? ["chromium" as const] : []),
    ]);
  }

  private exclusive(
    id: AgentToolId,
    operation: () => Promise<void>,
    mode: AgentToolQueueMode = "ensure",
  ): Promise<void> {
    return this.queue.run({
      id,
      mode,
      states: this.states,
      operation,
      onError: (error) => {
        this.fail(id, agentToolFailureDiagnostic(error));
        return this.refusal(id);
      },
    });
  }

  private async dependenciesReady(tool: AgentToolDefinition): Promise<void> {
    for (const id of tool.dependencies) {
      try {
        await this.ensureTool(id);
      } catch (error: unknown) {
        this.states.set(tool.id, {
          location: this.states.get(tool.id)?.location ?? null,
          health: {
            status: "missing_dependency",
            diagnostic: "dependency_failed",
            version: null,
          },
          dependency: id,
          checkedAt: new Date().toISOString(),
        });
        throw error;
      }
    }
  }

  private async inspect(id: AgentToolId): Promise<void> {
    this.states.set(
      id,
      await inspectAgentTool({
        id,
        files: this.dependencies.files,
        system: this.dependencies.system,
        health: this.dependencies.health,
        signal: this.shutdownController.signal,
      }),
    );
  }

  private async ready(id: AgentToolId): Promise<void> {
    if (this.settingsFailure || this.shutdownController.signal.aborted)
      throw this.refusal(id);
    await this.inspect(id);
    const state = this.states.get(id);
    if (state?.health.status === "ready") return;
    const tool = agentToolDefinition(id);
    if (
      !isAgentToolInstallable(tool) ||
      state?.health.diagnostic === "permission_denied" ||
      state?.health.diagnostic === "active_sessions"
    )
      throw this.refusal(id);
    await this.install(
      id,
      state?.location?.source === "managed" ? "repairing" : "installing",
    );
  }

  private async install(
    id: AgentToolId,
    status: "installing" | "updating" | "repairing",
  ): Promise<void> {
    if (this.settingsFailure || this.shutdownController.signal.aborted)
      throw this.refusal(id);
    const tool = agentToolDefinition(id);
    if (!isAgentToolInstallable(tool))
      throw new AgentToolReadinessError(id, "unsupported", "not_installed");
    const prior = this.states.get(id) ?? UNCHECKED_TOOL_STATE;
    this.states.set(id, {
      ...prior,
      health: { ...prior.health, status, diagnostic: "not_checked" },
    });
    try {
      // A repair reinstalls the active version; installation and update take the reviewed one.
      const kept =
        status === "repairing" && prior.location?.source === "managed"
          ? prior.location.version
          : null;
      await this.combinations.install(
        tool,
        kept !== null && isAgentToolVersionSupported(tool, kept)
          ? kept
          : tool.version,
      );
    } catch (error: unknown) {
      this.states.set(id, {
        location: prior.location,
        health: {
          status: "failed",
          diagnostic:
            error instanceof AgentToolReadinessError
              ? error.diagnostic
              : agentToolFailureDiagnostic(error),
          version: prior.health.version,
        },
        dependency: null,
        checkedAt: new Date().toISOString(),
      });
      throw this.refusal(id);
    }
  }

  private async remove(id: AgentToolId): Promise<void> {
    if (this.activities(id).length > 0)
      throw new AgentToolReadinessError(id, "failed", "active_sessions");
    await this.dependencies.files.remove(agentToolDefinition(id));
    this.states.set(id, {
      location: null,
      health: {
        status: "missing_dependency",
        diagnostic: "removed",
        version: null,
      },
      dependency: null,
      checkedAt: new Date().toISOString(),
    });
  }

  private async rollback(id: AgentToolId): Promise<void> {
    this.states.set(
      id,
      await rollbackAgentTool({
        id,
        files: this.dependencies.files,
        health: this.dependencies.health,
        signal: this.shutdownController.signal,
      }),
    );
  }

  private activities(id: AgentToolId): readonly AgentToolActivity[] {
    return mergeAgentToolActivities(
      this.supervisor.activities(id),
      this.dependencies.activities?.(id) ?? [],
    );
  }

  private fail(id: AgentToolId, diagnostic: AgentToolDiagnostic): void {
    const prior = this.states.get(id);
    this.states.set(id, {
      location: prior?.location ?? null,
      health: {
        status: "failed",
        diagnostic,
        version: prior?.health.version ?? null,
      },
      dependency: null,
      checkedAt: new Date().toISOString(),
    });
  }

  private refusal(id: AgentToolId): AgentToolReadinessError {
    const state = this.states.get(id);
    return new AgentToolReadinessError(
      id,
      state?.health.status ?? "failed",
      state?.health.diagnostic ?? "not_installed",
    );
  }

  private view(tool: AgentToolDefinition, enabled: boolean): AgentToolView {
    const state = this.states.get(tool.id) ?? UNCHECKED_TOOL_STATE;
    return agentToolView({
      tool,
      enabled,
      ...state,
      update: agentToolUpdateView(
        tool,
        state,
        this.dependencies.updates,
        this.operations,
      ),
      lastSuccessfulCheck: this.states.lastSuccessfulCheck(tool.id),
      release: this.dependencies.updates.view(tool, {
        installed: state.checkedAt === null ? null : state.location !== null,
        version: state.location?.version ?? state.health.version,
        source: state.location?.source ?? null,
      }),
      operation: this.operations.get(tool.id),
      connections: this.connections.get(tool.id) ?? [],
      activities: this.activities(tool.id),
      authentication: [...this.authentication]
        .filter(([, check]) => check.tool === tool.id)
        .map(([connectionId, check]) => ({
          connectionId,
          isReady: check.isReady,
        })),
    });
  }
}
