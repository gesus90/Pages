import type { DatabaseTransaction } from "@/backend/database/Database";

/** Serializes explicit replacement selection while retaining every immutable attachment original. */
export class AgentAssetRevisionRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** A replaced source is no longer the current revision for another replacement. */
  public async isReplaced(
    sourceId: string,
    sourceType: "ticket" | "wiki",
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      SELECT source_attachment_id
      FROM agent_asset_revisions
      WHERE source_attachment_id = $source_id
          AND source_type = $source_type;
    `,
      { source_id: sourceId, source_type: sourceType },
    );
    return rows.length > 0;
  }

  /** The caller shares the transaction of the new attachment and the replay result. */
  public async insert(
    sourceId: string,
    replacementId: string,
    expectedDigest: string,
    sourceType: "ticket" | "wiki",
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_asset_revisions (
          source_type,
          source_attachment_id,
          replacement_attachment_id,
          expected_digest
      ) VALUES (
          $source_type,
          $source_id,
          $replacement_id,
          $expected_digest
      );
    `,
      {
        source_type: sourceType,
        source_id: sourceId,
        replacement_id: replacementId,
        expected_digest: expectedDigest,
      },
    );
  }
}
