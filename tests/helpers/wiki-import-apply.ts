import { rm } from "node:fs/promises";
import path from "node:path";

import { afterEach } from "vitest";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { WikiImportService } from "@/backend/service/agents/WikiImportService";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { useMigratedDatabase } from "./test-database";
import {
  createWikiImportHarness,
  importPlan,
  importRequest,
} from "./wiki-import";

import type { AgentWikiCreateDependencies } from "@/backend/service/agents/AgentWikiCreateService";
import type {
  AgentImportApplied,
  AgentImportApplyInput,
} from "@/definition/AgentImportApply";
import type { AgentImportPlanInput } from "@/definition/AgentImportManifest";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { WikiImportHarness } from "./wiki-import";

export const IMPORT_IDENTITY: AgentIdentity = {
  userId: "writer",
  isAdmin: false,
  permissions: ["write"],
};

/** Real isolated persistence, policy and file stores for application tests. */
export interface WikiImportApplyHarness extends WikiImportHarness {
  readonly dependencies: AgentWikiCreateDependencies;
  readonly imports: WikiImportService;
  readonly mappings: AgentImportRepository;
}

/** Gives each application test a migrated memory database and removes its test files afterwards. */
export function useWikiImportApplyHarness(): () => Promise<WikiImportApplyHarness> {
  const getDatabase = useMigratedDatabase();
  const directories: string[] = [];
  afterEach(async () => {
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true });
  });
  return async () => {
    const harness = await createWikiImportHarness(getDatabase());
    directories.push(harness.filesDirectory);
    const dependencies = {
      database: harness.database,
      staging: new WikiFileStore(path.join(harness.filesDirectory, "staging")),
      wikiFiles: new WikiFileStore(
        path.join(harness.filesDirectory, "attachments"),
      ),
      events: new PagesEventPublisher(),
    };
    return {
      ...harness,
      dependencies,
      imports: new WikiImportService(dependencies),
      mappings: new AgentImportRepository(harness.database),
    };
  };
}

/** Confirms the current read-only plan for a package, including plans with source diagnostics. */
export async function confirmedImport(
  harness: WikiImportHarness,
  input: AgentImportPlanInput = importRequest(),
  operationId = "import-1",
): Promise<AgentImportApplyInput> {
  const request = {
    projectId: input.projectId,
    parentId: input.parentId,
    manifest: input.manifest,
  };
  const plan = importPlan(await harness.planner.plan(harness.actor, request));
  return { ...request, fingerprint: plan.fingerprint, operationId, assets: [] };
}

/** Narrows the write response through the wiki source schema rather than a type assertion. */
export function appliedImport(
  response: PagesAgentWriteResponse,
): AgentImportApplied {
  const result = response.result;
  if (!("runId" in result)) throw new Error("Expected an import run.");
  return {
    ...result,
    items: result.items.map((item) => {
      if (!("pageId" in item)) throw new Error("Expected a wiki import item.");
      return item;
    }),
  };
}
