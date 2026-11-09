import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentAssetRevisionRepository } from "@/backend/database/repositories/agents/AgentAssetRevisionRepository";
import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentPlanAssetRepository } from "@/backend/database/repositories/agents/AgentPlanAssetRepository";

import { DIGEST, OWNER, PROJECT } from "./plan-fixtures";
import {
  call,
  MISSING_TEXT,
  refused,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { StoredAgentAsset } from "@/backend/database/repositories/agents/AgentAssetRepository";
import type { StoredAgentImportSource } from "@/backend/database/repositories/agents/AgentImportRepository";
import type { AgentImportItem } from "@/definition/AgentImportApply";
import type { AgentStructuredImportItem } from "@/definition/AgentStructuredImportManifest";

const ASSET: StoredAgentAsset = {
  id: "asset-a",
  userId: OWNER,
  status: "staged",
  fileName: "Größe.png",
  contentType: "image/png",
  kind: "media",
  size: 5_000_000_000,
  checksum: DIGEST,
  storageName: "storage-b",
  expiresAt: 1_700_000_000_000,
  pageId: null,
  attachmentId: null,
  createdAt: 1_600_000_000_000,
};

const IMPORT_RUN = {
  id: "import-run",
  userId: OWNER,
  projectId: PROJECT,
  status: "running",
  snapshotJson: '{"package":1}',
};

const SOURCE: StoredAgentImportSource = {
  projectId: PROJECT,
  sourceKey: "source-a",
  targetKind: "wiki",
  targetId: "page-a",
  contentHash: DIGEST,
  targetRevision: 1,
  resultJson: '{"result":1}',
  lastRunId: "import-run",
};

const ITEM: AgentImportItem = {
  sourceKey: "source-b",
  targetKey: "target-b",
  action: "created",
  pageId: "page-b",
  link: "/wiki/page-b",
  assets: [],
  errorCode: null,
};

const STRUCTURED_ITEM: AgentStructuredImportItem = {
  kind: "ticket",
  sourceKey: "source-a",
  targetKey: "target-a",
  action: "conflict",
  targetId: null,
  key: null,
  link: null,
  parentId: null,
  milestoneId: null,
  assets: [],
  reason: null,
  errorCode: "CONFLICT",
};

function assets({ database }: RepositoryWorld): AgentAssetRepository {
  return new AgentAssetRepository(database);
}

function imports({ database }: RepositoryWorld): AgentImportRepository {
  return new AgentImportRepository(database);
}

function operations({
  database,
}: RepositoryWorld): AgentOperationKeyRepository {
  return new AgentOperationKeyRepository(database);
}

/** Files of agents in staging, and their replacement. */
export const AGENT_ASSET_FLOW: RepositoryFlow = {
  title: "agent assets",
  steps: [
    call("AgentAssetRepository.find", (world) => assets(world).find("asset-a")),
    call("AgentAssetRepository.insert", (world) => assets(world).insert(ASSET)),
    call("AgentAssetRepository.insert", (world) =>
      assets(world).insert({
        ...ASSET,
        id: "asset-b",
        kind: "file",
        storageName: "storage-a",
      }),
    ),
    call("AgentAssetRepository.insert", (world) =>
      assets(world).insert({
        ...ASSET,
        id: "asset-c",
        storageName: "storage-c",
        expiresAt: 1_500_000_000_000,
      }),
    ),
    refused("AgentAssetRepository.insert", (world) =>
      assets(world).insert(ASSET),
    ),
    reversedInPostgres("agent_assets"),
    call("AgentAssetRepository.find", (world) => assets(world).find("asset-a")),
    call("AgentAssetRepository.expired", (world) =>
      assets(world).expired(1_800_000_000_000),
    ),
    call("AgentAssetRepository.expired", (world) =>
      assets(world).expired(1_000),
    ),
    call("AgentAssetRepository.stagedStorageNames", (world) =>
      assets(world).stagedStorageNames(),
    ),
    call("AgentAssetRepository.link", (world) =>
      assets(world).link("asset-a", "page-a", "attachment-a"),
    ),
    call("AgentAssetRepository.markExpired", (world) =>
      assets(world).markExpired("asset-b"),
    ),
    call("AgentAssetRepository.find", (world) => assets(world).find("asset-a")),
    call("AgentAssetRepository.expired", (world) =>
      assets(world).expired(1_800_000_000_000),
    ),
    call("AgentAssetRepository.stagedStorageNames", (world) =>
      assets(world).stagedStorageNames(),
    ),
    call("AgentAssetRepository.remove", (world) =>
      assets(world).remove("asset-b"),
    ),
    call("AgentAssetRepository.remove", (world) =>
      assets(world).remove("asset-missing"),
    ),
    stored("SELECT id FROM agent_assets WHERE id LIKE 'asset-%' ORDER BY id;"),
    call("AgentAssetRevisionRepository.isReplaced", ({ database }) =>
      new AgentAssetRevisionRepository(database).isReplaced("source-a", "wiki"),
    ),
    call("AgentAssetRevisionRepository.insert", ({ database }) =>
      new AgentAssetRevisionRepository(database).insert(
        "source-a",
        "replacement-a",
        DIGEST,
        "wiki",
      ),
    ),
    call("AgentAssetRevisionRepository.isReplaced", ({ database }) =>
      new AgentAssetRevisionRepository(database).isReplaced("source-a", "wiki"),
    ),
    call("AgentAssetRevisionRepository.isReplaced", ({ database }) =>
      new AgentAssetRevisionRepository(database).isReplaced(
        "source-a",
        "ticket",
      ),
    ),
    refused("AgentAssetRevisionRepository.insert", ({ database }) =>
      new AgentAssetRevisionRepository(database).insert(
        "source-a",
        "replacement-b",
        DIGEST,
        "wiki",
      ),
    ),
  ],
};

/** Resumable imports with their counters. */
export const AGENT_IMPORT_FLOW: RepositoryFlow = {
  title: "agent imports",
  steps: [
    call("AgentImportRepository.findRun", (world) =>
      imports(world).findRun("import-run", OWNER, PROJECT),
    ),
    call("AgentImportRepository.insertRun", (world) =>
      imports(world).insertRun(IMPORT_RUN),
    ),
    refused("AgentImportRepository.insertRun", (world) =>
      imports(world).insertRun(IMPORT_RUN),
    ),
    call("AgentImportRepository.findRun", (world) =>
      imports(world).findRun("import-run", OWNER, PROJECT),
    ),
    call("AgentImportRepository.findRun", (world) =>
      imports(world).findRun("import-run", "user-other", PROJECT),
    ),
    call("AgentImportRepository.findSource", (world) =>
      imports(world).findSource(PROJECT, "source-a"),
    ),
    call("AgentImportRepository.insertSource", (world) =>
      imports(world).insertSource(SOURCE),
    ),
    refused("AgentImportRepository.insertSource", (world) =>
      imports(world).insertSource(SOURCE),
    ),
    call("AgentImportRepository.refreshSource", (world) =>
      imports(world).refreshSource({
        projectId: PROJECT,
        sourceKey: "source-a",
        contentHash: "c".repeat(64),
        targetRevision: 2,
        lastRunId: "import-run-2",
      }),
    ),
    call("AgentImportRepository.findSource", (world) =>
      imports(world).findSource(PROJECT, "source-a"),
    ),
    call("AgentImportRepository.touchSource", (world) =>
      imports(world).touchSource(PROJECT, "source-a", "import-run-3"),
    ),
    call("AgentImportRepository.findSource", (world) =>
      imports(world).findSource(PROJECT, "source-a"),
    ),
    call("AgentImportRepository.findItem", (world) =>
      imports(world).findItem("import-run", "source-b"),
    ),
    call("AgentImportRepository.findStoredItem", (world) =>
      imports(world).findStoredItem("import-run", "source-a"),
    ),
    call("AgentImportRepository.recordItem", (world) =>
      imports(world).recordItem("import-run", 2, ITEM),
    ),
    call("AgentImportRepository.recordStructuredItem", (world) =>
      imports(world).recordStructuredItem("import-run", 2, STRUCTURED_ITEM),
    ),
    call("AgentImportRepository.recordItem", (world) =>
      imports(world).recordItem("import-run", 1, {
        ...ITEM,
        sourceKey: "source-c",
        action: "skipped",
      }),
    ),
    refused("AgentImportRepository.recordItem", (world) =>
      imports(world).recordItem("import-run", 3, ITEM),
    ),
    refused("AgentImportRepository.recordItem", (world) =>
      imports(world).recordItem("import-run", 3, {
        ...ITEM,
        sourceKey: MISSING_TEXT,
      }),
    ),
    reversedInPostgres("agent_import_items"),
    call("AgentImportRepository.findItem", (world) =>
      imports(world).findItem("import-run", "source-b"),
    ),
    call("AgentImportRepository.findStoredItem", (world) =>
      imports(world).findStoredItem("import-run", "source-a"),
    ),
    call("AgentImportRepository.listItems", (world) =>
      imports(world).listItems("import-run"),
    ),
    call("AgentImportRepository.listStoredItems", (world) =>
      imports(world).listStoredItems("import-run"),
    ),
    stored(`
      SELECT status, created_count, skipped_count, conflict_count, failed_count, finished_at IS NULL
      FROM agent_import_runs
      WHERE id = 'import-run';
    `),
    call("AgentImportRepository.finishRun", (world) =>
      imports(world).finishRun("import-run"),
    ),
    call("AgentImportRepository.finishRun", (world) =>
      imports(world).finishRun("import-run"),
    ),
    call("AgentImportRepository.findRun", (world) =>
      imports(world).findRun("import-run", OWNER, PROJECT),
    ),
    call("AgentImportRepository.finishRun", (world) =>
      imports(world).finishRun("import-run-empty"),
    ),
  ],
};

/** Stored results of operations, for repeating after a lost answer. */
export const AGENT_OPERATION_FLOW: RepositoryFlow = {
  title: "agent operation keys",
  steps: [
    call("AgentOperationKeyRepository.find", (world) =>
      operations(world).find(OWNER, "operation-1"),
    ),
    call("AgentOperationKeyRepository.insert", (world) =>
      operations(world).insert(OWNER, "operation-1", {
        fingerprint: DIGEST,
        operation: "save_plan",
        resultJson: '{"ok":true}',
      }),
    ),
    call("AgentOperationKeyRepository.find", (world) =>
      operations(world).find(OWNER, "operation-1"),
    ),
    call("AgentOperationKeyRepository.find", (world) =>
      operations(world).find("user-other", "operation-1"),
    ),
    refused("AgentOperationKeyRepository.insert", (world) =>
      operations(world).insert(OWNER, "operation-1", {
        fingerprint: DIGEST,
        operation: "save_plan",
        resultJson: "{}",
      }),
    ),
  ],
};

function planAssets({ database }: RepositoryWorld): AgentPlanAssetRepository {
  return new AgentPlanAssetRepository(database);
}

/** Files of asset nodes in agent plans. */
export const PLAN_ASSET_FLOW: RepositoryFlow = {
  title: "agent plan assets",
  steps: [
    call("AgentPlanAssetRepository.find", (world) =>
      planAssets(world).find("asset-plan-1"),
    ),
    call("AgentPlanAssetRepository.results", (world) =>
      planAssets(world).results("run-1"),
    ),
    call("AgentPlanAssetRepository.insert", (world) =>
      planAssets(world).insert({
        id: "asset-plan-1",
        projectId: PROJECT,
        ownerId: OWNER,
        fileName: "test.png",
        mediaType: "image/png",
        kind: "image",
        size: 1024,
        checksum: DIGEST,
        storageName: "storage-plan-1",
        originRunId: "run-1",
        originStepId: "step-1",
        originAssetId: null,
      }),
    ),
    call("AgentPlanAssetRepository.find", (world) =>
      planAssets(world).find("asset-plan-1"),
    ),
    call("AgentPlanAssetRepository.results", (world) =>
      planAssets(world).results("run-1"),
    ),
  ],
};
