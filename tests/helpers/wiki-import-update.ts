import { WikiImportUpdateService } from "@/backend/service/agents/WikiImportUpdateService";

import { importPlan, importRequest } from "./wiki-import";
import { useWikiImportApplyHarness } from "./wiki-import-apply";

import type { AgentImportPlanInput } from "@/definition/AgentImportManifest";
import type {
  AgentImportUpdated,
  AgentImportUpdateInput,
} from "@/definition/AgentImportUpdate";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { WikiImportApplyHarness } from "./wiki-import-apply";

/** Adds the update service to the existing isolated import harness. */
export interface WikiImportUpdateHarness extends WikiImportApplyHarness {
  readonly updates: WikiImportUpdateService;
}

/** Reuses the migrated memory database and cleanup of the import harness. */
export function useWikiImportUpdateHarness(): () => Promise<WikiImportUpdateHarness> {
  const setup = useWikiImportApplyHarness();
  return async () => {
    const harness = await setup();
    return {
      ...harness,
      updates: new WikiImportUpdateService(harness.dependencies),
    };
  };
}

/** Confirms the current plan with each source's last imported revision. */
export async function confirmedUpdate(
  harness: WikiImportApplyHarness,
  input: AgentImportPlanInput = importRequest(),
  operationId = "update-1",
): Promise<AgentImportUpdateInput> {
  const plan = importPlan(await harness.planner.plan(harness.actor, input));
  const updates = [];
  for (const file of input.manifest.files) {
    const mapping = await harness.mappings.findSource(
      input.projectId,
      file.sourceKey,
    );
    updates.push({
      sourceKey: file.sourceKey,
      expectedRevision: mapping?.targetRevision ?? 1,
      overwrite: false,
    });
  }
  return { ...input, operationId, fingerprint: plan.fingerprint, updates };
}

/** Narrows a write response to the update outcome through its public schema. */
export function updatedImport(
  response: PagesAgentWriteResponse,
): AgentImportUpdated {
  const result = response.result;
  if (!("items" in result) || "runId" in result)
    throw new Error("Expected an import update result.");
  return result;
}
