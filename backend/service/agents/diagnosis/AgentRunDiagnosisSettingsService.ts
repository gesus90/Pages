import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  AGENT_RUN_LOG_RETENTION_RANGE,
  AGENT_RUN_STALL_MINUTES_RANGE,
} from "@/definition/AgentRunDiagnosis";

import { requireAgentAdministrator } from "../AgentServiceAccess";

import type { AgentRunDiagnosisSettingsRepository } from "@/backend/database/repositories/diagnosis/AgentRunDiagnosisSettingsRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentRunDiagnosisSettings } from "@/definition/AgentRunDiagnosis";

/** A submitted change of the diagnosis settings. */
export type AgentRunDiagnosisSettingsInput = AgentRunDiagnosisSettings;

function isWithin(
  value: number,
  range: { readonly minimum: number; readonly maximum: number },
): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= range.minimum &&
    value <= range.maximum
  );
}

/**
 * The settings of the run diagnosis under Settings → Agents (PAGE-307).
 *
 * @remarks
 * Only an administrator in the active admin mode reads the form and saves.
 * The retention time applies to the log lines and failure records of runs;
 * the stall time decides when a silent step is marked as without progress.
 */
export class AgentRunDiagnosisSettingsService {
  private readonly settings: Pick<
    AgentRunDiagnosisSettingsRepository,
    "read" | "save"
  >;
  private readonly writes = new SerialQueue();

  public constructor(
    settings: Pick<AgentRunDiagnosisSettingsRepository, "read" | "save">,
  ) {
    this.settings = settings;
  }

  /** Supplies the settings card. */
  public async administration(
    actor: AccountAccess,
  ): Promise<AgentRunDiagnosisSettings> {
    requireAgentAdministrator(actor);
    return this.settings.read();
  }

  /**
   * Saves the settings.
   *
   * @throws {AgentError} `profile_invalid` for a value outside its range,
   * `profile_conflict` after a concurrent change.
   */
  public async save(
    actor: AccountAccess,
    input: AgentRunDiagnosisSettingsInput,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    if (
      !isWithin(input.logRetentionDays, AGENT_RUN_LOG_RETENTION_RANGE) ||
      !isWithin(input.stallMinutes, AGENT_RUN_STALL_MINUTES_RANGE)
    )
      throw new AgentError("profile_invalid");
    await this.writes.run(() => this.settings.save(input));
  }
}
