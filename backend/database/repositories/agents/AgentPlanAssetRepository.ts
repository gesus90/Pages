import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isPlanAssetKind } from "@/definition/AgentPlanAsset";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentPlanAssetKind } from "@/definition/AgentPlanAsset";

/** A stored plan asset with its storage handle; never serialized to a client as is. */
export interface StoredPlanAsset {
  readonly id: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly kind: AgentPlanAssetKind;
  readonly size: number;
  readonly checksum: string;
  readonly storageName: string;
  readonly originRunId: string | null;
  readonly originStepId: string | null;
  readonly originAssetId: string | null;
  readonly createdAt: string;
}

const COLUMNS = `
    id,
    project_id,
    owner_id,
    file_name,
    media_type,
    kind,
    size,
    checksum,
    storage_name,
    origin_run_id,
    origin_step_id,
    origin_asset_id,
    created_at
`;

function readKind(row: readonly DatabaseValue[]): AgentPlanAssetKind {
  const kind = readTextColumn(row, 5, "kind");
  return isPlanAssetKind(kind) ? kind : "other";
}

function readAsset(row: readonly DatabaseValue[]): StoredPlanAsset {
  return {
    id: readTextColumn(row, 0, "id"),
    projectId: readTextColumn(row, 1, "project_id"),
    ownerId: readTextColumn(row, 2, "owner_id"),
    fileName: readTextColumn(row, 3, "file_name"),
    mediaType: readTextColumn(row, 4, "media_type"),
    kind: readKind(row),
    size: readCountColumn(row, 6, "size"),
    checksum: readTextColumn(row, 7, "checksum"),
    storageName: readTextColumn(row, 8, "storage_name"),
    originRunId: readNullableTextColumn(row, 9, "origin_run_id"),
    originStepId: readNullableTextColumn(row, 10, "origin_step_id"),
    originAssetId: readNullableTextColumn(row, 11, "origin_asset_id"),
    createdAt: readTextColumn(row, 12, "created_at"),
  };
}

/** Persists the files of asset nodes; rows are only ever added. */
export class AgentPlanAssetRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Inserts a completely written file; a partial upload never has a row. */
  public async insert(
    asset: Omit<StoredPlanAsset, "createdAt">,
  ): Promise<StoredPlanAsset> {
    const [row] = await this.database.query(
      `
      INSERT INTO agent_plan_assets (
          id,
          project_id,
          owner_id,
          file_name,
          media_type,
          kind,
          size,
          checksum,
          storage_name,
          origin_run_id,
          origin_step_id,
          origin_asset_id
      )
      VALUES (
          $id,
          $project_id,
          $owner_id,
          $file_name,
          $media_type,
          $kind,
          $size,
          $checksum,
          $storage_name,
          $origin_run_id,
          $origin_step_id,
          $origin_asset_id
      )
      RETURNING ${COLUMNS};
    `,
      {
        id: asset.id,
        project_id: asset.projectId,
        owner_id: asset.ownerId,
        file_name: asset.fileName,
        media_type: asset.mediaType,
        kind: asset.kind,
        size: asset.size,
        checksum: asset.checksum,
        storage_name: asset.storageName,
        origin_run_id: asset.originRunId,
        origin_step_id: asset.originStepId,
        origin_asset_id: asset.originAssetId,
      },
    );
    if (!row) throw new Error("The plan asset was not stored.");
    return readAsset(row);
  }

  /** Finds an asset without granting access to it. */
  public async find(id: string): Promise<StoredPlanAsset | null> {
    const [row] = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM agent_plan_assets
      WHERE id = $id;
    `,
      { id },
    );
    return row ? readAsset(row) : null;
  }

  /** The result files a node wrote in a run, oldest first. */
  public async results(runId: string): Promise<StoredPlanAsset[]> {
    return (
      await this.database.query(
        `
      SELECT ${COLUMNS}
      FROM agent_plan_assets
      WHERE origin_run_id = $run_id
      ORDER BY created_at, id;
    `,
        { run_id: runId },
      )
    ).map(readAsset);
  }
}
