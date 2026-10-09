import { parseStoredCatalog } from "@/backend/agents/catalog/CatalogParsing";
import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";
import {
  emptyModelCatalog,
  isCatalogInterval,
} from "@/definition/AgentModelCatalog";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AgentModelCatalog,
  CatalogInterval,
  AgentCatalogModel,
} from "@/definition/AgentModelCatalog";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";

interface CatalogRefreshResult {
  readonly attemptedAt: string;
  readonly errorCode: AgentErrorCode | null;
  /** Null preserves every entry and the last successful timestamp. */
  readonly models: readonly AgentCatalogModel[] | null;
}

function serializeModels(models: readonly AgentCatalogModel[]): string {
  return JSON.stringify(
    models.map((model) => ({
      id: model.id,
      name: model.name,
      context_length: model.contextWindow,
      pricing: { prompt: model.promptPrice, completion: model.completionPrice },
      reasoning_support: model.reasoning,
      reasoning: {
        supported_efforts: model.reasoningEfforts,
        default_effort: model.defaultReasoningEffort,
      },
    })),
  );
}

/** Persists catalog snapshots separately from diagnostic checks and credentials. */
export class AgentCatalogRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Reads only the sanitized catalog projection; absence means manual-only. */
  public async find(id: string): Promise<AgentModelCatalog> {
    const rows = await this.database.query(
      `
      SELECT
          interval_hours,
          next_refresh_at,
          attempted_at,
          refreshed_at,
          error_code,
          models_json
      FROM agent_model_catalogs
      WHERE connection_id = $id;
    `,
      { id },
    );
    const row = rows[0];
    if (!row) return emptyModelCatalog();
    const intervalHours = readCountColumn(row, 0, "interval_hours");
    if (!isCatalogInterval(intervalHours))
      throw new AgentError("catalog_interval_invalid");
    const error = readNullableTextColumn(row, 4, "error_code");
    const entries: unknown = JSON.parse(readTextColumn(row, 5, "models_json"));
    return {
      intervalHours,
      nextRefreshAt: readNullableTextColumn(row, 1, "next_refresh_at"),
      attemptedAt: readNullableTextColumn(row, 2, "attempted_at"),
      refreshedAt: readNullableTextColumn(row, 3, "refreshed_at"),
      errorCode: isAgentErrorCode(error) ? error : null,
      models: parseStoredCatalog(entries),
    };
  }

  /** Updates timing without changing the selected model, catalog or previous result. */
  public async configure(
    id: string,
    interval: CatalogInterval,
    nextRefreshAt: string | null,
  ): Promise<void> {
    await this.ensure(id);
    await this.database.execute(
      `
      UPDATE agent_model_catalogs
      SET
          interval_hours = $interval,
          next_refresh_at = $next_refresh_at
      WHERE connection_id = $id;
    `,
      { id, interval, next_refresh_at: nextRefreshAt },
    );
  }

  /** Atomically publishes a complete snapshot, or records a failure retaining the last good snapshot. */
  public async save(
    id: string,
    result: CatalogRefreshResult,
    nextRefreshAt: string | null,
  ): Promise<void> {
    await this.ensure(id);
    await this.database.execute(
      `
      UPDATE agent_model_catalogs
      SET
          attempted_at = $attempted_at,
          refreshed_at = COALESCE($refreshed_at, refreshed_at),
          error_code = $error_code,
          models_json = COALESCE($models_json, models_json),
          next_refresh_at = $next_refresh_at
      WHERE connection_id = $id;
    `,
      {
        id,
        attempted_at: result.attemptedAt,
        refreshed_at: result.models === null ? null : result.attemptedAt,
        error_code: result.errorCode,
        models_json:
          result.models === null ? null : serializeModels(result.models),
        next_refresh_at: nextRefreshAt,
      },
    );
  }

  /** Chooses only one due connection per tick, keeping restarts and large installations staggered. */
  public async nextDue(now: string): Promise<string | null> {
    const rows = await this.database.query(
      `
      SELECT agent_model_catalogs.connection_id
      FROM agent_model_catalogs
      INNER JOIN agent_connections
          ON agent_connections.id = agent_model_catalogs.connection_id
      WHERE agent_model_catalogs.interval_hours > 0
          AND agent_model_catalogs.next_refresh_at <= $now
      ORDER BY agent_model_catalogs.next_refresh_at, agent_model_catalogs.connection_id
      LIMIT 1;
    `,
      { now },
    );
    return rows[0] ? readTextColumn(rows[0], 0, "connection_id") : null;
  }

  /** Credential replacement discards account-specific catalog data but retains cadence. */
  public async invalidate(id: string): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_model_catalogs
      SET
          models_json = '[]',
          attempted_at = NULL,
          refreshed_at = NULL,
          error_code = NULL
      WHERE connection_id = $id;
    `,
      { id },
    );
  }

  /** Deletes the dependent catalog in the connection removal transaction. */
  public async remove(id: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM agent_model_catalogs WHERE connection_id = $id;",
      { id },
    );
  }

  private async ensure(id: string): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_model_catalogs (connection_id)
      VALUES ($id)
      ON CONFLICT DO NOTHING;
    `,
      { id },
    );
  }
}
