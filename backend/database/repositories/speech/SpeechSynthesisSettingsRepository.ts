import {
  readCountColumn,
  readNullableTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  isSpeechSynthesisDurationChoice,
  SPEECH_SYNTHESIS_DEFAULT_DURATION_MS,
} from "@/definition/SpeechSynthesis";

import type { Database } from "@/backend/database/Database";
import type { SpeechSynthesisSettings } from "@/definition/SpeechSynthesis";

/** Persists the one speech output setting of the instance (PAGE-300); it never holds audio. */
export class SpeechSynthesisSettingsRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads the setting; a stored duration outside the choices falls back to the default. */
  public async read(): Promise<SpeechSynthesisSettings> {
    const [row] = await this.database.query(`
      SELECT
          connection_id,
          model,
          max_duration_ms,
          revision
      FROM speech_synthesis_settings
      WHERE id = 1;
    `);
    if (!row) throw new AgentError("profile_invalid");
    const connectionId = readNullableTextColumn(row, 0, "connection_id");
    const model = readNullableTextColumn(row, 1, "model");
    const duration = readCountColumn(row, 2, "max_duration_ms");
    return {
      selection:
        connectionId === null || model === null
          ? null
          : { connectionId, model },
      maxDurationMs: isSpeechSynthesisDurationChoice(duration)
        ? duration
        : SPEECH_SYNTHESIS_DEFAULT_DURATION_MS,
      revision: readCountColumn(row, 3, "revision"),
    };
  }

  /**
   * Replaces model and longest output with optimistic concurrency.
   *
   * @param settings - The new setting with the revision it was read at.
   * @throws {AgentError} `profile_conflict` when the setting changed since.
   */
  public async save(settings: SpeechSynthesisSettings): Promise<void> {
    const rows = await this.database.query(
      `
      UPDATE speech_synthesis_settings
      SET connection_id = $connection_id,
          model = $model,
          max_duration_ms = $max_duration_ms,
          revision = revision + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
          AND revision = $revision
      RETURNING id;
    `,
      {
        connection_id: settings.selection?.connectionId ?? null,
        model: settings.selection?.model ?? null,
        max_duration_ms: settings.maxDurationMs,
        revision: settings.revision,
      },
    );
    if (rows.length === 0) throw new AgentError("profile_conflict");
  }
}
