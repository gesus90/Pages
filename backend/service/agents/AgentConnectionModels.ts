import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { supportsModelCatalog } from "@/definition/AgentModelCatalog";

import {
  requireVerifiedConnection,
  resolveAgentAssignmentFor,
} from "./AgentAssignmentResolution";
import { canUseAgentConnection } from "./AgentConnectionAccess";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type {
  AgentCatalogModel,
  AgentModelCatalog,
} from "@/definition/AgentModelCatalog";
import type {
  ConnectionCatalogState,
  ConnectionCatalogStatus,
  SavedConnectionState,
} from "@/definition/AgentModelCatalogStatus";
import type { PageAgentModel } from "@/definition/PageAgent";

/** Reads known models only; authentication and catalogs are never refreshed by selection. */
export async function connectionModels(
  connections: AgentConnectionRepository,
  viewer: AgentViewer,
): Promise<readonly PageAgentModel[]> {
  const choices: PageAgentModel[] = [];
  for (const connection of await connections.list()) {
    if (!(await canUseAgentConnection(connections, viewer, connection.id)))
      continue;
    const catalog = await connections.catalogs().find(connection.id);
    const models = selectionModels(connection, catalog.models);
    // Every model in this catalog shares the same connection grant and authentication.
    // Check those once per request, rather than repeating database reads for every model.
    if (!(await isAvailable({ connections, viewer, connection, models })))
      continue;
    // A failed last refresh keeps the stored models; their connection's state line says so.
    for (const model of models)
      choices.push(catalogModelChoice(connection, model));
  }
  return choices;
}

function selectionModels(
  connection: AgentConnectionRecord,
  models: readonly AgentCatalogModel[],
): readonly AgentCatalogModel[] {
  if (!supportsModelCatalog(connection.provider))
    return manualModels(connection);
  return connection.provider === "opencode"
    ? models.filter((model) => model.id.startsWith("opencode/") && model.isFree)
    : models;
}

function manualModels(
  connection: AgentConnectionRecord,
): readonly AgentCatalogModel[] {
  if (!connection.testModel) return [];
  return [
    {
      id: connection.testModel,
      name: connection.testModel,
      contextWindow: null,
      promptPrice: null,
      completionPrice: null,
      isFree: false,
      reasoning: "unknown",
      reasoningEfforts: [],
      defaultReasoningEffort: null,
    },
  ];
}

async function isAvailable(input: {
  readonly connections: AgentConnectionRepository;
  readonly viewer: AgentViewer;
  readonly connection: AgentConnectionRecord;
  readonly models: readonly AgentCatalogModel[];
}): Promise<boolean> {
  const { connections, viewer, connection, models } = input;
  const model = models.at(0);
  if (!model) return false;
  try {
    await resolveAgentAssignmentFor(connections, viewer, {
      connectionId: connection.id,
      model: model.id,
      reasoningEffort: null,
    });
    return true;
  } catch (error: unknown) {
    if (!(error instanceof AgentExecutionError)) throw error;
    return false;
  }
}

async function isAccessVerified(
  connections: AgentConnectionRepository,
  connectionId: string,
): Promise<boolean> {
  try {
    await requireVerifiedConnection(connections, connectionId);
    return true;
  } catch (error: unknown) {
    if (!(error instanceof AgentExecutionError)) throw error;
    return false;
  }
}

// An empty listing is stored as an incomplete catalog, so it is told apart from a failure.
function catalogState(
  catalog: AgentModelCatalog,
  isVerified: boolean,
): ConnectionCatalogState {
  if (!isVerified) return "unverified";
  const isListingOk = catalog.errorCode === null;
  if (catalog.models.length > 0) return isListingOk ? "loaded" : "failed";
  return isListingOk || catalog.errorCode === "catalog_incomplete"
    ? "empty"
    : "failed";
}

/**
 * Names the catalog state of every active connection the person may use.
 * @param connections - Connection persistence.
 * @param viewer - Current account facts and group memberships of the person.
 * @returns One status per usable connection, also those without a model, in
 * the order of the administration.
 * @remarks
 * Reads stored catalogs only; no provider is asked. The model count is the
 * number of models the connection offers before a place filters them.
 */
export async function connectionCatalogStatuses(
  connections: AgentConnectionRepository,
  viewer: AgentViewer,
): Promise<readonly ConnectionCatalogStatus[]> {
  const statuses: ConnectionCatalogStatus[] = [];
  for (const connection of await connections.list()) {
    if (!connection.isActive) continue;
    if (!(await canUseAgentConnection(connections, viewer, connection.id)))
      continue;
    const catalog = await connections.catalogs().find(connection.id);
    const isVerified = await isAccessVerified(connections, connection.id);
    statuses.push({
      connectionId: connection.id,
      connectionName: connection.name,
      provider: connection.provider,
      state: catalogState(catalog, isVerified),
      lastAttemptAt: catalog.attemptedAt,
      modelCount: selectionModels(connection, catalog.models).length,
    });
  }
  return statuses;
}

/**
 * Tells how a saved connection relates to the person who looks at it.
 * @param connections - Connection persistence.
 * @param viewer - Current account facts and group memberships of the person.
 * @param connectionId - The connection a saved model names.
 * @returns `missing` for an unknown or switched-off connection, `denied` where
 * the scope excludes the person, otherwise `available`.
 */
export async function savedConnectionState(
  connections: AgentConnectionRepository,
  viewer: AgentViewer,
  connectionId: string,
): Promise<SavedConnectionState> {
  const connection = await connections.find(connectionId);
  if (!connection?.isActive) return "missing";
  return (await canUseAgentConnection(connections, viewer, connectionId))
    ? "available"
    : "denied";
}
