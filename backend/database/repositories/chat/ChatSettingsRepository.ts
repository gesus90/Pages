import {
  readCountColumn,
  readNullableTextColumn,
} from "@/backend/database/RowValue";
import { CHAT_ATTACHMENT_LIMITS, CHAT_MEBIBYTE } from "@/definition/Chat";

import type { Database } from "@/backend/database/Database";
import type { ChatSettings } from "@/definition/Chat";

/** The single settings row of the chat, seeded by its migration. */
export class ChatSettingsRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads the settings; a missing row means the defaults. */
  public async read(): Promise<ChatSettings> {
    const rows = await this.database.query(
      `
      SELECT
          attachment_limit_bytes,
          system_instruction
      FROM chat_settings
      WHERE id = 1;
    `,
    );
    if (rows.length === 0)
      return {
        attachmentLimitBytes:
          CHAT_ATTACHMENT_LIMITS.defaultMegabytes * CHAT_MEBIBYTE,
        systemInstruction: null,
      };
    return {
      attachmentLimitBytes: readCountColumn(
        rows[0],
        0,
        "attachment_limit_bytes",
      ),
      systemInstruction: readNullableTextColumn(
        rows[0],
        1,
        "system_instruction",
      ),
    };
  }

  /** Replaces the settings validated by the service. */
  public async save(settings: ChatSettings): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO chat_settings (
          id,
          attachment_limit_bytes,
          system_instruction
      )
      VALUES (
          1,
          $attachment_limit_bytes,
          $system_instruction
      )
      ON CONFLICT (id) DO UPDATE SET
          attachment_limit_bytes = excluded.attachment_limit_bytes,
          system_instruction = excluded.system_instruction,
          updated_at = utc_now();
    `,
      {
        attachment_limit_bytes: settings.attachmentLimitBytes,
        system_instruction: settings.systemInstruction,
      },
    );
  }
}
