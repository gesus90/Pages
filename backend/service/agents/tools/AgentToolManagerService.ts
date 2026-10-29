import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";
import { requireAgentAdministrator } from "@/backend/service/agents/AgentServiceAccess";

import {
  AGENT_TOOL_REGISTRY,
  agentToolDefinition,
  providerToolIds,
  isAgentToolInstallable,
} from "./AgentToolRegistry";
import { AgentToolReadinessError } from "./AgentToolReadinessError";
import { AgentRuntimeSupervisor } from "./AgentRuntimeSupervisor";

import type {
  CliToolLocation,
  CliProviderId,
} from "@/definition/AgentConnection";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentToolActivity,
  AgentToolAction,
  AgentToolDiagnostic,
  AgentToolId,
  AgentToolView,
} from "@/definition/AgentTools";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type {
  AgentToolHealth,
  AgentToolHealthChecks,
  AgentToolInstallation,
  AgentToolLocation,
  AgentToolStorage,
} from "./AgentToolContracts";

interface ManagerDependencies {
  readonly activities?: (id: AgentToolId) => readonly AgentToolActivity[];
  readonly files: AgentToolStorage;
  readonly installer: AgentToolInstallation;
  readonly health: AgentToolHealthChecks;
  readonly system: (
    tool: AgentToolDefinition,
  ) => Promise<AgentToolLocation | null>;
}

interface ToolState {
  readonly location: AgentToolLocation | null;
  readonly health: AgentToolHealth;
  readonly dependency: AgentToolId | null;
  readonly checkedAt: string | null;
}

const UNCHECKED: AgentToolHealth = {
  status: "missing_dependency",
  diagnostic: "not_checked",
  version: null,
};

/** Central fixed-registry readiness, installation, repair and update coordination. */
export class AgentToolManagerService {
  public readonly supervisor = new AgentRuntimeSupervisor();
  private readonly dependencies: ManagerDependencies;
  private readonly authentication = new Map<
    string,
    { readonly tool: AgentToolId; readonly isReady: boolean }
  >();
  private readonly states = new Map<AgentToolId, ToolState>();
  private readonly pending = new Map<AgentToolId, Promise<void>>();
  private readonly shutdownController = new AbortController();
  private readonly requested = new Set<AgentToolId>();
  private readonly startupTools = new Set<AgentToolId>([
    "node",
    "bubblewrap",
    "pages_mcp",
  ]);
  private started: Promise<void> | null = null;
  private settingsFailure = false;
  private settingsQueue: Promise<void> = Promise.resolve();

  public constructor(dependencies: ManagerDependencies) {
    this.dependencies = dependencies;
  }

  /** Instance-local directory mounted read-only for every native session. */
  public get directory(): string {
    return this.dependencies.files.root;
  }

  /** Returns cached secret-free metadata after checking active system administrator rights. */
  public list(actor: AccountAccess): readonly AgentToolView[] {
    requireAgentAdministrator(actor);
    const enabled = this.enabled();
    return AGENT_TOOL_REGISTRY.map((tool) =>
      this.view(tool, enabled.has(tool.id)),
    );
  }

  /** Reconstructs readiness after restart; optional failures never reject Pages startup. */
  public start(providers: readonly CliProviderId[] = []): Promise<void> {
    for (const provider of providers)
      for (const id of providerToolIds(provider)) this.startupTools.add(id);
    this.started ??= this.restore();
    return this.started;
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
        await this.dependenciesReady(agentToolDefinition(id));
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
          current.health.version === agentToolDefinition(id).version
        )
          return;
        await this.install(id, action === "update" ? "updating" : "repairing");
      },
      true,
    );
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

  /** Installs provider prerequisites before login/check operations use the existing runtime. */
  public async ensureProvider(provider: CliProviderId): Promise<void> {
    await this.start();
    await this.ensureTool(providerToolIds(provider)[0]);
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

  /** Used by the shared execution path before a native node can start. */
  public async ensureReady(input: {
    readonly provider: CliProviderId;
    readonly hasPagesMcp: boolean;
    readonly browser: boolean;
    readonly instanceId: string;
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
      "bubblewrap",
      ...providerToolIds(input.provider),
      ...(input.hasPagesMcp ? ["pages_mcp" as const] : []),
      ...(input.browser ? ["chromium" as const] : []),
    ];
    const required = this.closure(ids);
    this.supervisor.reserve(input.instanceId, [...required]);
    try {
      const locations = new Map<AgentToolId, AgentToolLocation>();
      for (const id of required) locations.set(id, await this.ensureTool(id));
      return locations;
    } catch (error: unknown) {
      this.supervisor.release(input.instanceId);
      throw error;
    }
  }

  /** Cancels bounded installer/probe children through the existing runner before server exit. */
  public async shutdown(): Promise<void> {
    this.shutdownController.abort();
    await Promise.allSettled([...this.pending.values()]);
    await this.settingsQueue;
  }

  private async restore(): Promise<void> {
    try {
      for (const id of await this.dependencies.files.readEnabled())
        this.requested.add(id);
    } catch {
      this.settingsFailure = true;
      for (const tool of AGENT_TOOL_REGISTRY)
        this.fail(tool.id, "settings_unavailable");
      console.warn(
        "[pages] Agent tool settings cannot be read; managed installation is blocked.",
      );
      return;
    }
    for (const id of this.enabled()) {
      try {
        await this.ensureTool(id);
        await this.updateApprovedTarget(id);
      } catch {
        console.warn(
          `[pages] Agent tool ${id} is unavailable (${this.states.get(id)?.health.diagnostic ?? "dependency_failed"}).`,
        );
      }
    }
  }

  private async updateApprovedTarget(id: AgentToolId): Promise<void> {
    await this.exclusive(
      id,
      async () => {
        const tool = agentToolDefinition(id);
        const state = this.states.get(id);
        if (
          (tool.packageName !== null || tool.id === "antigravity_acp") &&
          state?.location?.source === "managed" &&
          state.health.status === "ready" &&
          state.health.version !== tool.version &&
          state.location.approvedTarget !== tool.version
        )
          await this.install(id, "updating");
      },
      true,
    );
  }

  private enabled(): Set<AgentToolId> {
    return this.closure([
      ...this.startupTools,
      ...this.requested,
      ...(this.requested.has("playwright_mcp") ? ["chromium" as const] : []),
    ]);
  }

  private closure(ids: readonly AgentToolId[]): Set<AgentToolId> {
    const result = new Set(ids);
    for (const id of result)
      for (const dependency of agentToolDefinition(id).dependencies)
        result.add(dependency);
    return result;
  }

  private async exclusive(
    id: AgentToolId,
    operation: () => Promise<void>,
    mustRun = false,
  ): Promise<void> {
    const previous = this.pending.get(id);
    if (previous) {
      await previous;
      if (!mustRun) return;
      return this.exclusive(id, operation, true);
    }
    const work = Promise.resolve().then(operation);
    this.pending.set(id, work);
    try {
      await work;
    } catch (error: unknown) {
      if (!(error instanceof AgentToolReadinessError))
        this.fail(id, this.failureReason(error));
      throw error instanceof AgentToolReadinessError ? error : this.refusal(id);
    } finally {
      if (this.pending.get(id) === work) this.pending.delete(id);
    }
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
    const tool = agentToolDefinition(id);
    const location =
      (await this.dependencies.files.current(tool)) ??
      (await this.dependencies.system(tool));
    const health = location
      ? await this.dependencies.health.check(
          tool,
          location,
          this.shutdownController.signal,
        )
      : {
          status: "missing_dependency" as const,
          diagnostic: "not_installed" as const,
          version: null,
        };
    this.states.set(id, {
      location: location ? { ...location, version: health.version } : null,
      health,
      dependency: null,
      checkedAt: new Date().toISOString(),
    });
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
    const prior = this.states.get(id) ?? {
      location: null,
      health: UNCHECKED,
      dependency: null,
      checkedAt: null,
    };
    this.states.set(id, {
      ...prior,
      health: { ...prior.health, status, diagnostic: "not_checked" },
    });
    let candidate: AgentToolLocation | null = null;
    try {
      candidate = await this.dependencies.files.candidate(tool);
      await this.dependencies.installer.install(
        tool,
        candidate,
        this.shutdownController.signal,
      );
      const health = await this.dependencies.health.check(
        tool,
        candidate,
        this.shutdownController.signal,
      );
      if (health.status !== "ready")
        throw new AgentToolReadinessError(id, health.status, health.diagnostic);
      if (health.version !== tool.version)
        throw new AgentToolReadinessError(
          id,
          "unsupported",
          "version_unsupported",
        );
      await this.dependencies.files.activate(tool, candidate);
      this.states.set(id, {
        location: candidate,
        health,
        dependency: null,
        checkedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      if (candidate) await this.dependencies.files.discard(candidate);
      this.states.set(id, {
        location: prior.location,
        health: {
          status: "failed",
          diagnostic:
            error instanceof AgentToolReadinessError
              ? error.diagnostic
              : this.failureReason(error),
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
    const tool = agentToolDefinition(id);
    const candidate = await this.dependencies.files.previous(tool);
    if (!candidate)
      throw new AgentToolReadinessError(id, "failed", "rollback_failed");
    const health = await this.dependencies.health.check(
      tool,
      candidate,
      this.shutdownController.signal,
    );
    if (health.status !== "ready") {
      throw new AgentToolReadinessError(id, "failed", "rollback_failed");
    }
    await this.dependencies.files.activate(tool, candidate);
    this.states.set(id, {
      location: { ...candidate, version: health.version },
      health,
      dependency: null,
      checkedAt: new Date().toISOString(),
    });
  }

  private activities(id: AgentToolId): readonly AgentToolActivity[] {
    const pinned = this.supervisor.activities(id);
    const processes = this.dependencies.activities?.(id) ?? [];
    return [
      ...pinned,
      ...processes.filter(
        (activity) =>
          !pinned.some((lease) => lease.processId === activity.processId),
      ),
    ];
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

  private failureReason(error: unknown): AgentToolDiagnostic {
    if (error instanceof AgentAccessDeniedError) return "permission_denied";
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "EACCES" || error.code === "EPERM")
    )
      return "permission_denied";
    return "installation_failed";
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
    const state = this.states.get(tool.id) ?? {
      location: null,
      health: UNCHECKED,
      dependency: null,
      checkedAt: null,
    };
    const { location, health } = state;
    const authentication = [...this.authentication]
      .filter(([, check]) => check.tool === tool.id)
      .map(([connectionId, check]) => ({
        connectionId,
        isReady: check.isReady,
      }));
    const needsLogin =
      authentication.length > 0 &&
      authentication.every((check) => !check.isReady);
    return {
      id: tool.id,
      name: tool.name,
      kind: tool.kind,
      enabled,
      status:
        health.status === "ready" && needsLogin
          ? "authentication_required"
          : health.status,
      diagnostic:
        health.status === "ready" && needsLogin
          ? "authentication_required"
          : health.diagnostic,
      dependency: state.dependency,
      installed: state.checkedAt === null ? null : location !== null,
      installedVersion:
        tool.kind === "browser"
          ? (health.runtimeVersion ?? null)
          : health.version,
      supportedVersions: tool.versions,
      approvedVersion: tool.version,
      updateAvailable:
        (tool.packageName !== null || tool.id === "antigravity_acp") &&
        health.version !== null &&
        tool.version !== health.version,
      source: location?.source ?? null,
      lastCheck: state.checkedAt,
      activities: this.activities(tool.id),
      authentication,
    };
  }
}
