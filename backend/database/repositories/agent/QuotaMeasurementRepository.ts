import { z } from "zod";

import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { quotaPaceSchema } from "@/definition/QuotaForecast";
import { zaiQuotaReadingSchema } from "@/definition/ZaiQuota";

import type { Database } from "@/backend/database/Database";
import type { ZaiQuotaReading } from "@/definition/ZaiQuota";

const measuredWindowSchema = z.object({
  resetsAt: z.string(),
  durationMinutes: z.number().positive(),
  used: z.number().min(0).max(100),
  pace: quotaPaceSchema,
});

const seriesSchema = measuredWindowSchema.extend({
  points: z.array(z.tuple([z.number().int(), z.number().min(0).max(100)])),
});

const seriesByWindowSchema = z.record(z.string(), seriesSchema);
const measuredWindowsSchema = z.record(z.string(), measuredWindowSchema);

/** Stored points of one window, ordered from oldest to newest. */
export type QuotaSeries = z.infer<typeof seriesSchema>;

/** The latest readings of a connection, including its per-window series. */
export interface QuotaMeasurement {
  readonly observedAt: number;
  readonly credentialRevision: string | null;
  readonly windows: Readonly<Record<string, QuotaSeries>>;
  readonly zaiReading?: ZaiQuotaReading;
}

/** Latest readings and forecast inputs without the raw points. */
export type MeasuredQuotaWindows = z.infer<typeof measuredWindowsSchema>;

/** Persists quota readings for each connection with serialized updates. */
export class QuotaMeasurementRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Replaces the measurement under the connection lock. Older observations
   * and repeated deliveries of the same observation have no effect.
   */
  public async update(
    connectionId: string,
    observedAt: number,
    measure: (
      previous: QuotaMeasurement | null,
    ) => Omit<QuotaMeasurement, "observedAt">,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const parameters = { connection_id: connectionId };
      const [connection] = await transaction.query(
        "SELECT id FROM agent_connections WHERE id = $connection_id FOR NO KEY UPDATE;",
        parameters,
      );
      if (!connection) return;
      const [row] = await transaction.query(
        `
        SELECT
            observed_at,
            credential_revision,
            windows::TEXT
        FROM agent_quota_measurements
        WHERE connection_id = $connection_id;
        `,
        parameters,
      );
      const previous = row
        ? {
            observedAt: readCountColumn(row, 0, "observed_at"),
            credentialRevision: readNullableTextColumn(
              row,
              1,
              "credential_revision",
            ),
            windows: seriesByWindowSchema.parse(
              JSON.parse(readTextColumn(row, 2, "windows")),
            ),
          }
        : null;
      if (previous && previous.observedAt >= observedAt) return;
      const measurement = measure(previous);
      await transaction.execute(
        `
        INSERT INTO agent_quota_measurements (
            connection_id,
            observed_at,
            credential_revision,
            windows,
            zai_reading
        )
        VALUES (
            $connection_id,
            $observed_at,
            $credential_revision,
            $windows::JSONB,
            $zai_reading::JSONB
        )
        ON CONFLICT (connection_id) DO UPDATE SET
            observed_at = excluded.observed_at,
            credential_revision = excluded.credential_revision,
            windows = excluded.windows,
            zai_reading = excluded.zai_reading;
        `,
        {
          ...parameters,
          observed_at: observedAt,
          credential_revision: measurement.credentialRevision,
          windows: JSON.stringify(measurement.windows),
          zai_reading: measurement.zaiReading
            ? JSON.stringify(measurement.zaiReading)
            : null,
        },
      );
    });
  }

  /** Reads forecast inputs only for the connections already visible to the caller. */
  public async read(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, MeasuredQuotaWindows>> {
    if (ids.length === 0) return new Map();
    const rows = await this.database.query(
      `
      SELECT
          connection_id,
          COALESCE((
              SELECT jsonb_object_agg(window_key, series - 'points')
              FROM jsonb_each(windows) AS entries(window_key, series)
          ), '{}'::JSONB)::TEXT
      FROM agent_quota_measurements
      WHERE connection_id IN (SELECT jsonb_array_elements_text($ids::JSONB));
      `,
      { ids: JSON.stringify(ids) },
    );
    return new Map<string, MeasuredQuotaWindows>(
      rows.map((row) => [
        readTextColumn(row, 0, "connection_id"),
        measuredWindowsSchema.parse(
          JSON.parse(readTextColumn(row, 1, "windows")),
        ),
      ]),
    );
  }

  /** Reads the stored Z.AI figures only for the current credential revision. */
  public async readZaiReading(
    connectionId: string,
    revision: string,
  ): Promise<(ZaiQuotaReading & { readonly at: string }) | null> {
    const [row] = await this.database.query(
      `
      SELECT
          observed_at,
          zai_reading::TEXT
      FROM agent_quota_measurements
      WHERE connection_id = $connection_id
          AND credential_revision = $revision
          AND zai_reading IS NOT NULL;
      `,
      { connection_id: connectionId, revision },
    );
    if (!row) return null;
    return {
      ...zaiQuotaReadingSchema.parse(
        JSON.parse(readTextColumn(row, 1, "zai_reading")),
      ),
      at: new Date(readCountColumn(row, 0, "observed_at")).toISOString(),
    };
  }

  /** Drops the displayed figures when Z.AI rejects the current credential. */
  public async clearZaiReading(
    connectionId: string,
    revision: string,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_quota_measurements
      SET zai_reading = NULL
      WHERE connection_id = $connection_id
          AND credential_revision = $revision
          AND zai_reading IS NOT NULL;
      `,
      { connection_id: connectionId, revision },
    );
  }
}
