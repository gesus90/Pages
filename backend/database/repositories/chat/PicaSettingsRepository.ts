import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
} from "@/backend/database/RowValue";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readAgentConfiguration } from "@/backend/agents/AgentConfigurationInput";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { AgentError } from "@/backend/error/AgentErrors";

import type { Database } from "@/backend/database/Database";
import type { PicaSettings } from "@/definition/PicaSettings";
import type { AgentModelSelection } from "@/definition/AgentModelSelection";

function readSelection(json: string | null): AgentModelSelection | null {
  if (json === null) return null;
  const selection = readAgentObject(JSON.parse(json));
  if (
    typeof selection.connectionId !== "string" ||
    typeof selection.model !== "string" ||
    (selection.reasoningEffort !== null &&
      typeof selection.reasoningEffort !== "string")
  )
    throw new AgentError("profile_invalid");
  return {
    connectionId: selection.connectionId,
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
  };
}

/** Persists the fixed Pica identity separately from retained legacy profiles. */
export class PicaSettingsRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads the singleton and its one-time legacy adoption marker. */
  public async read(): Promise<
    PicaSettings & { readonly legacyChecked: boolean }
  > {
    const [row] = await this.database.query(`
      SELECT is_enabled, selection_json, run_json, revision, legacy_checked
      FROM pica_settings
      WHERE id = 1;
    `);
    if (!row) throw new AgentError("profile_invalid");
    const runJson = readNullableTextColumn(row, 2, "run_json");
    const run: unknown = runJson === null ? null : JSON.parse(runJson);
    return {
      isEnabled: readBooleanColumn(row, 0, "is_enabled"),
      selection: readSelection(
        readNullableTextColumn(row, 1, "selection_json"),
      ),
      run:
        run === null
          ? null
          : (readAgentConfiguration({
              ...emptyAgentConfiguration(),
              run,
            }).run ?? null),
      revision: readCountColumn(row, 3, "revision"),
      legacyChecked: readBooleanColumn(row, 4, "legacy_checked"),
    };
  }

  /** Atomically replaces activation, model and reasoning with optimistic concurrency. */
  public async save(settings: PicaSettings): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const rows = await transaction.query(
        `
        UPDATE pica_settings
        SET is_enabled = $enabled,
            selection_json = $selection,
            run_json = $run,
            revision = revision + 1,
            legacy_checked = TRUE
        WHERE id = 1
            AND revision = $revision
        RETURNING id;
      `,
        {
          enabled: settings.isEnabled,
          selection:
            settings.selection === null
              ? null
              : JSON.stringify(settings.selection),
          run: settings.run === null ? null : JSON.stringify(settings.run),
          revision: settings.revision,
        },
      );
      if (rows.length === 0) throw new AgentError("profile_conflict");
    });
  }
}
