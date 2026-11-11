import { AgentRunActivityRepository } from "@/backend/database/repositories/diagnosis/AgentRunActivityRepository";
import { AgentRunDiagnosisSettingsRepository } from "@/backend/database/repositories/diagnosis/AgentRunDiagnosisSettingsRepository";
import { AgentRunFailureRepository } from "@/backend/database/repositories/diagnosis/AgentRunFailureRepository";
import { AgentRunLogRepository } from "@/backend/database/repositories/diagnosis/AgentRunLogRepository";

import { AgentPlanRunTeamReader } from "./AgentPlanRunTeamReader";
import { AgentRunDiagnosisService } from "./AgentRunDiagnosisService";
import { AgentRunFailureIndexer } from "./AgentRunFailureIndexer";

import type { Database } from "@/backend/database/Database";
import type { PlanRunReadDependencies } from "../AgentPlanRunReader";
import type { RunStarterDirectory } from "./AgentPlanRunTeamReader";

/** The tables the diagnosis of runs reads and writes (PAGE-307). */
export interface AgentRunDiagnosisStores {
  readonly failures: AgentRunFailureRepository;
  readonly logs: AgentRunLogRepository;
  readonly activity: AgentRunActivityRepository;
  readonly settings: AgentRunDiagnosisSettingsRepository;
}

/**
 * Opens the diagnosis tables on a database.
 *
 * @param database - The instance database.
 */
export function createAgentRunDiagnosisStores(
  database: Database,
): AgentRunDiagnosisStores {
  return {
    failures: new AgentRunFailureRepository(database),
    logs: new AgentRunLogRepository(database),
    activity: new AgentRunActivityRepository(database),
    settings: new AgentRunDiagnosisSettingsRepository(database),
  };
}

/** Names nobody: a plan service without accounts shows the identifier. */
export const UNNAMED_STARTERS: RunStarterDirectory = {
  displayName: () => Promise.resolve(null),
};

/**
 * Builds the team reader and the diagnosis over the dependencies of the plan service.
 *
 * @param dependencies - The read dependencies of the plan service.
 * @param parts - Who names starters and where the diagnosis keeps its tables.
 */
export function createAgentRunDiagnosis(
  dependencies: PlanRunReadDependencies,
  parts: {
    readonly starters: RunStarterDirectory;
    readonly stores: AgentRunDiagnosisStores | undefined;
  },
): {
  readonly reader: AgentPlanRunTeamReader;
  readonly service: AgentRunDiagnosisService | null;
} {
  const reader = new AgentPlanRunTeamReader(dependencies, parts.starters);
  const { stores } = parts;
  if (stores === undefined) return { reader, service: null };
  return {
    reader,
    service: new AgentRunDiagnosisService({
      reader,
      plans: dependencies.access,
      failures: stores.failures,
      indexer: new AgentRunFailureIndexer(stores.failures, stores.settings),
      logs: stores.logs,
      activity: stores.activity,
      settings: stores.settings,
    }),
  };
}
