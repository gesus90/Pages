import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { requireAgentAdministrator } from "@/backend/service/agents/AgentServiceAccess";

import { providerToolIds, toolProvider } from "./AgentToolRegistry";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentCheckService } from "@/backend/service/agents/AgentCheckService";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentCheckSummary,
  CliProviderId,
} from "@/definition/AgentConnection";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type {
  AgentToolAction,
  AgentToolConnectionView,
  AgentToolId,
} from "@/definition/AgentTools";
import type { AgentToolManagerService } from "./AgentToolManagerService";

/** Sign-in results the provider reports when it asks for a new login. */
const LOGIN_REQUIRED_CODES: ReadonlySet<string> = new Set([
  "cli_not_logged_in",
  "cli_auth_failed",
  "provider_auth_failed",
]);

/** Actions after which the connections are checked again with the new generation. */
const REBINDING_ACTIONS: ReadonlySet<AgentToolAction> = new Set([
  "install",
  "update",
  "rollback",
]);

interface RebindDependencies {
  readonly manager: Pick<
    AgentToolManagerService,
    | "manage"
    | "ensureTool"
    | "recordAuthentication"
    | "recordConnections"
    | "recordRebinding"
  >;
  readonly connections: Pick<AgentConnectionRepository, "list" | "catalogs">;
  readonly checks: Pick<AgentCheckService, "run">;
}

// The saved choice stays as it is; only its absence from the new catalog is reported.
function missingSelection(
  connection: AgentConnectionRecord,
  catalog: AgentModelCatalog,
): Pick<AgentToolConnectionView, "missingModel" | "missingReasoningEffort"> {
  const model = connection.testModel;
  if (model === null || catalog.models.length === 0)
    return { missingModel: null, missingReasoningEffort: null };
  const offered = catalog.models.find((entry) => entry.id === model);
  if (!offered) return { missingModel: model, missingReasoningEffort: null };
  const effort = connection.reasoningEffort;
  return {
    missingModel: null,
    missingReasoningEffort:
      effort !== null && !offered.reasoningEfforts.includes(effort)
        ? effort
        : null,
  };
}

function connectionStatus(
  check: AgentCheckSummary | null,
): AgentToolConnectionView["status"] {
  if (check?.status === "passed") return "ready";
  return check?.errorCode && LOGIN_REQUIRED_CODES.has(check.errorCode)
    ? "login_required"
    : "failed";
}

/**
 * Binds the existing connections of a provider to its verified tool generation again.
 * @remarks
 * Re-binding keeps every connection: its identity, its isolated login, its
 * plan assignments and its rights. It runs the model-free access check with
 * the generation new sessions start and, after a confirmed access, the
 * catalog refresh, which keeps the last valid catalog when a listing fails.
 * No login data is read, moved or removed, and no prompt is sent.
 */
export class AgentToolRebindService {
  private readonly dependencies: RebindDependencies;

  public constructor(dependencies: RebindDependencies) {
    this.dependencies = dependencies;
  }

  /** Runs a tool action and then re-binds the connections that start that tool. */
  public async manage(
    actor: AccountAccess,
    id: AgentToolId,
    action: AgentToolAction,
  ): Promise<void> {
    if (action === "rebind") {
      await this.rebind(actor, id);
      return;
    }
    await this.dependencies.manager.manage(actor, id, action);
    if (REBINDING_ACTIONS.has(action) && toolProvider(id) !== null)
      await this.rebind(actor, id);
  }

  /** Checks every connection of the tool's provider again and refreshes its catalog. */
  public async rebind(actor: AccountAccess, id: AgentToolId): Promise<void> {
    requireAgentAdministrator(actor);
    const provider = toolProvider(id);
    if (provider === null) throw new AgentError("configuration_invalid");
    const { manager, connections } = this.dependencies;
    manager.recordRebinding(id, "running");
    try {
      for (const toolId of providerToolIds(provider))
        await manager.ensureTool(toolId);
      const views: AgentToolConnectionView[] = [];
      for (const connection of await connections.list()) {
        if (connection.provider !== provider) continue;
        views.push(await this.rebindConnection(actor, connection, provider));
      }
      manager.recordConnections(id, views);
      manager.recordRebinding(id, "succeeded");
    } catch (error: unknown) {
      manager.recordRebinding(id, "failed");
      throw error;
    }
  }

  private async rebindConnection(
    actor: AccountAccess,
    connection: AgentConnectionRecord,
    provider: CliProviderId,
  ): Promise<AgentToolConnectionView> {
    const { manager, connections, checks } = this.dependencies;
    let check: AgentCheckSummary | null = null;
    let errorCode: string | null = null;
    try {
      check = await checks.run(actor, connection.id, "auth");
      errorCode = check.errorCode;
    } catch (error: unknown) {
      logCaughtError("AgentToolRebindService", error);
      errorCode = error instanceof AgentError ? error.code : "general";
    }
    const status = connectionStatus(check);
    manager.recordAuthentication(connection.id, provider, status === "ready");
    const catalog = await connections.catalogs().find(connection.id);
    return {
      connectionId: connection.id,
      name: connection.name,
      status,
      errorCode,
      checkedAt: check?.checkedAt ?? new Date().toISOString(),
      modelCount: catalog.models.length,
      catalogRefreshedAt: catalog.refreshedAt,
      isCatalogStale: catalog.errorCode !== null,
      catalogErrorCode: catalog.errorCode,
      ...missingSelection(connection, catalog),
    };
  }
}
