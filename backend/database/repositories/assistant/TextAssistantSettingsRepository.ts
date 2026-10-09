import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";

import type { Database } from "@/backend/database/Database";
import type {
  TextAssistantPreferences,
  TextAssistantSettings,
} from "@/definition/TextAssistant";

/** Stores the singleton role and independently owned personal preferences. */
export class TextAssistantSettingsRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads configuration without joining any connection credentials. */
  public async read(): Promise<TextAssistantSettings> {
    const [row] = await this.database.query(`
      SELECT
          agent_function_assignments.connection_id,
          agent_function_assignments.model,
          agent_function_assignments.reasoning_effort,
          text_assistant_settings.retention_days
      FROM text_assistant_settings
      LEFT JOIN agent_function_assignments
          ON agent_function_assignments.function = 'text'
      WHERE text_assistant_settings.id = 1;
    `);
    const connectionId = readNullableTextColumn(row, 0, "connection_id");
    const model = readNullableTextColumn(row, 1, "model");
    return {
      role:
        connectionId === null || model === null
          ? null
          : {
              connectionId,
              model,
              reasoningEffort: readNullableTextColumn(
                row,
                2,
                "reasoning_effort",
              ),
            },
      retentionDays: readCountColumn(row, 3, "retention_days"),
    };
  }

  /** Saves a validated assignment and the instance retention period together. */
  public async save(settings: TextAssistantSettings): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const assignments = new AgentAssignmentRepository(transaction);
      if (settings.role === null) await assignments.remove("text");
      else await assignments.save({ function: "text", ...settings.role });
      await transaction.execute(
        `
      UPDATE text_assistant_settings
      SET
          retention_days = $retention_days
      WHERE id = 1;
    `,
        {
          retention_days: settings.retentionDays,
        },
      );
    });
  }

  /** Changes retention without reading or overwriting any function assignment. */
  public async saveRetention(retentionDays: number): Promise<void> {
    await this.database.execute(
      "UPDATE text_assistant_settings SET retention_days = $retention_days WHERE id = 1;",
      { retention_days: retentionDays },
    );
  }

  /** Returns defaults until the actor explicitly changes their preferences. */
  public async preferences(userId: string): Promise<TextAssistantPreferences> {
    const [row] = await this.database.query(
      `
      SELECT
          auto_apply,
          target_language
      FROM text_assistant_preferences
      WHERE user_id = $user_id;
    `,
      { user_id: userId },
    );
    return row
      ? {
          autoApply: readBooleanColumn(row, 0, "auto_apply"),
          targetLanguage: readTextColumn(row, 1, "target_language"),
        }
      : { autoApply: false, targetLanguage: "de" };
  }

  /** Updates only the specified actor's preference row. */
  public async savePreferences(
    userId: string,
    preferences: TextAssistantPreferences,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO text_assistant_preferences (
          user_id,
          auto_apply,
          target_language
      ) VALUES ($user_id, $auto_apply, $target_language)
      ON CONFLICT (user_id) DO UPDATE SET
          auto_apply = EXCLUDED.auto_apply,
          target_language = EXCLUDED.target_language;
    `,
      {
        user_id: userId,
        auto_apply: preferences.autoApply,
        target_language: preferences.targetLanguage,
      },
    );
  }
}
