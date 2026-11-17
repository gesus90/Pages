import {
  resolveModelIdentity,
  resolveReasoningIdentity,
} from "@/definition/AgentModelIdentity";
import { logCaughtError } from "@/backend/logging/Logger";

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

/**
 * The model and reasoning of a session as structured identity for the badges.
 * @remarks
 * Only Claude Code sessions get it; other providers keep their text values.
 * The concrete model the adapter reported with its usage is kept apart from
 * the configuration it confirmed, so an alias such as `haiku` becomes
 * `Haiku 5.5` only together with the catalog and the reported model.
 */
export async function describeSessionIdentity(
  record: AgentPlanSessionRecord,
  model: AgentSessionModelReport,
  readCatalogOf: SessionCatalogReader | undefined,
): Promise<Pick<AgentSessionView, "modelIdentity" | "reasoning">> {
  if (record.runner !== "claude_code") return {};
  const catalog = await readCatalog(
    record.requested.connectionId,
    readCatalogOf,
  );
  const isReported = model.confirmedModel.source === "acp_usage_report";
  const modelIdentity = resolveModelIdentity({
    provider: "claude_code",
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
  };
}
