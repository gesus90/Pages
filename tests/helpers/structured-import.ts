import path from "node:path";

import { expect } from "vitest";

import { StructuredImportService } from "@/backend/service/agents/StructuredImportService";
import { createStructuredImportEnvironment } from "@/backend/service/agents/StructuredImportEnvironment";
import { readStructuredManifest } from "@/backend/service/agents/StructuredImportManifestReader";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { planningIdentity, useAgentPlanningHarness } from "./agent-planning";

import type {
  AgentStructuredImportApplied,
  AgentStructuredImportApplyInput,
  AgentStructuredManifest,
} from "@/definition/AgentStructuredImportManifest";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";

/** A complete graph; children precede parents to exercise application ordering. */
export function structuredManifest(
  overrides: Partial<AgentStructuredManifest> = {},
): AgentStructuredManifest {
  return readStructuredManifest({
    version: "1",
    sources: [
      { kind: "project", key: "project", projectId: "p1" },
      { kind: "milestone", key: "release", name: "Release" },
      { kind: "milestone", key: "next", name: "Next" },
      { kind: "ticket", key: "child", type: "subtask", title: "Child" },
      { kind: "ticket", key: "parent", type: "task", title: "Parent" },
      { kind: "wiki", key: "guide/start.md", content: "# Guide\n\nBody" },
    ],
    links: [
      { type: "parent", from: "child", to: "parent" },
      { type: "milestone", from: "parent", to: "release" },
      { type: "dependency", from: "release", to: "next", linkType: "blocks" },
    ],
    assets: [],
    wiki: { project: "project", parentId: null },
    ...overrides,
  });
}

async function createStructuredHarness(
  harness: Awaited<ReturnType<ReturnType<typeof useAgentPlanningHarness>>>,
) {
  const creation = {
    database: harness.database,
    staging: new WikiFileStore(path.join(harness.filesDirectory, "staging")),
    wikiFiles: new WikiFileStore(harness.filesDirectory),
    events: harness.events,
  };
  return {
    ...harness,
    creation,
    structured: new StructuredImportService({
      creation,
      planning: harness.planning,
    }),
    environment: await createStructuredImportEnvironment(
      harness.database,
      "owner",
    ),
  };
}

/** Shares the existing isolated DuckDB, policy and planning fixture. */
export function useStructuredImportHarness(): () => Promise<
  Awaited<ReturnType<typeof createStructuredHarness>>
> {
  const setup = useAgentPlanningHarness();
  return async () => createStructuredHarness(await setup());
}

export type StructuredHarness = Awaited<
  ReturnType<ReturnType<typeof useStructuredImportHarness>>
>;

/** Confirms exactly the preview the application will recheck. */
export async function confirmedStructuredImport(
  harness: StructuredHarness,
  manifest: AgentStructuredManifest = structuredManifest(),
  operationId = "structured",
): Promise<AgentStructuredImportApplyInput> {
  const preview = await harness.structured.plan(planningIdentity, { manifest });
  return { manifest, operationId, fingerprint: preview.result.fingerprint };
}

/** Narrows the public write union through its observable source schema. */
export function structuredResult(
  response: PagesAgentWriteResponse,
): AgentStructuredImportApplied {
  if (!("runId" in response.result)) throw new Error("Expected import run.");
  const items = response.result.items.map((item) => {
    if (!("kind" in item)) throw new Error("Expected structured item.");
    return item;
  });
  return { ...response.result, items };
}

/** Imports once with a real account and returns the durable outcome. */
export async function applyStructured(
  harness: StructuredHarness,
  manifest: AgentStructuredManifest = structuredManifest(),
  operationId = "structured",
): Promise<AgentStructuredImportApplied> {
  const input = await confirmedStructuredImport(harness, manifest, operationId);
  const outcome = structuredResult(
    await harness.structured.apply(
      planningIdentity,
      input,
      async () => planningIdentity,
    ),
  );
  expect(outcome.items).toHaveLength(
    outcome.counts.created +
      outcome.counts.skipped +
      outcome.counts.conflict +
      outcome.counts.failed,
  );
  return outcome;
}

/** Stages real PNG bytes and a durable handle owned by the test account. */
export async function stageStructuredAsset(
  harness: StructuredHarness,
  id = "asset",
): Promise<void> {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=",
    "base64",
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(png);
      controller.close();
    },
  });
  const staged = await harness.creation.staging.write(stream, {
    absoluteLimit: 1024,
    limitFor: () => 1024,
  });
  await harness.database.execute(
    `INSERT INTO agent_assets (
      id, user_id, file_name, storage_name, content_type, kind, checksum, size, status, created_at, expires_at
    ) VALUES ($id, 'owner', 'image.png', $name, 'image/png', 'media', $checksum, $size, 'staged', 0, $expires);`,
    {
      id,
      name: staged.storageName,
      checksum: staged.checksum,
      size: staged.size,
      expires: Date.now() + 60000,
    },
  );
}
