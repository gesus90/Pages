import {
  modelBadgeVendor,
  resolveModelIdentity,
  resolveReasoningIdentity,
} from "@/definition/AgentModelIdentity";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type { AgentCatalogModelName } from "@/definition/AgentModelIdentity";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentSessionModelReport,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

/** Reads the catalog of a connection; an empty list when it has none. */
export type SessionCatalogReader = (
  connectionId: string,
) => Promise<readonly AgentCatalogModelName[]>;

async function readCatalog(
  connectionId: string,
  read: SessionCatalogReader | undefined,
): Promise<readonly AgentCatalogModelName[]> {
  if (!read) return [];
  try {
    return await read(connectionId);
  } catch (error: unknown) {
    logCaughtError("AgentSessionModelIdentity", error);

    // Without the catalog the badges show the reported values as they are.
    return [];
  }
}

/** The runner as provider of a model badge; `null` for one that keeps text values. */
function badgeProvider(
  runner: AgentPlanSessionRecord["runner"],
): AcpProviderId | null {
  if (runner === "api" || modelBadgeVendor(runner) === null) return null;
  return runner;
}

/** The identity of a session's model and the context window its catalog entry states. */
export interface SessionIdentity extends Pick<
  AgentSessionView,
  "modelIdentity" | "reasoning"
> {
  readonly contextWindow: number | null;
}

/** The window of the catalog entry the identity resolved to; `null` for an unresolved or unlisted model. */
function catalogContextWindow(
  modelIdentity: AgentSessionView["modelIdentity"],
  catalog: readonly AgentCatalogModelName[],
): number | null {
  if (!modelIdentity?.modelId) return null;
  const entry = catalog.find(({ id }) => id === modelIdentity.modelId);
  return entry?.contextWindow ?? null;
}

/**
 * The model and reasoning of a session as structured identity for the badges.
 * @remarks
 * Claude Code, Codex, Antigravity, OpenCode, OpenRouter and direct Z.AI
 * sessions have model badges. Codex, Antigravity and OpenCode, including its
 * linked OpenRouter and Z.AI connections, confirm their model and level
 * through their configuration options.
 * The concrete model the adapter reported with its usage, or the Claude CLI
 * of a runner in its events, is kept apart from the configuration it
 * confirmed, so an alias such as `haiku` becomes `Haiku 5.5` only together
 * with the catalog and the reported model.
 */
export async function describeSessionIdentity(
  record: AgentPlanSessionRecord,
  model: AgentSessionModelReport,
  readCatalogOf: SessionCatalogReader | undefined,
): Promise<SessionIdentity> {
  const provider = badgeProvider(record.runner);
  if (provider === null) return { contextWindow: null };
  const catalog = await readCatalog(
    record.requested.connectionId,
    readCatalogOf,
  );
  // The adapter's usage report and the CLI's own events name the concrete model, not a selector value.
  const isReported =
    model.confirmedModel.source === "acp_usage_report" ||
    model.confirmedModel.source === "cli_stream_event";
  const modelIdentity = resolveModelIdentity({
    provider,
    requested: model.requestedModel.value,
    configured: isReported
      ? (record.effective?.model ?? null)
      : model.confirmedModel.value,
    reported: isReported ? model.confirmedModel.value : null,
    catalog,
  });
  return {
    modelIdentity,
    reasoning: resolveReasoningIdentity({
      requested: model.requestedReasoning.value,
      confirmed: model.confirmedReasoning.value,
      model: modelIdentity,
      catalog,
    }),
    contextWindow: catalogContextWindow(modelIdentity, catalog),
  };
}
