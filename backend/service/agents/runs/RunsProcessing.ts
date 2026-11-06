import {
  hasRunApiOwnership,
  setRunApiOwnership,
  canProcessRuns,
  isPagesRunsProcess,
  setRunsOwnership,
} from "@/backend/runtime/RunsMode";
import { PlanRunOwnerRepository } from "@/backend/database/repositories/agent/PlanRunOwnerRepository";
import { logEvent } from "@/backend/logging/Logger";

import type { PagesConfig } from "@/backend/config/PagesConfig";

let owner: PlanRunOwnerRepository | null = null;
let apiOwner: PlanRunOwnerRepository | null = null;

/** Claims the database-wide engine lock only in the configured process role. */
export async function claimRunsProcessing(config: PagesConfig): Promise<void> {
  const role = isPagesRunsProcess() ? "separate" : "server";
  if ((config.runsMode ?? "server") !== role || canProcessRuns()) return;
  if (config.firstRun || !config.databaseUrl)
    throw new Error("Run processing requires completed PostgreSQL setup.");
  owner = new PlanRunOwnerRepository(config.databaseUrl, () => {
    setRunsOwnership(false);
    logEvent({
      level: "fatal",
      event: "runs.ownership.lost",
      component: "RunsProcessing",
      message: "Run ownership lost; terminating scheduler",
    });
    process.exit(1);
  });
  if (!(await owner.acquire()))
    throw new Error("Another process owns the plan engine.");
  setRunsOwnership(true);
}

/** API restart may recover chat sessions only after excluding another live API owner. */
export async function claimRunApiProcessing(
  config: PagesConfig,
): Promise<void> {
  if (
    isPagesRunsProcess() ||
    config.runsMode !== "separate" ||
    hasRunApiOwnership()
  )
    return;
  if (config.firstRun || !config.databaseUrl)
    throw new Error("Run API processing requires PostgreSQL setup.");
  apiOwner = new PlanRunOwnerRepository(
    config.databaseUrl,
    () => process.exit(1),
    "api",
  );
  if (!(await apiOwner.acquire()))
    throw new Error("Another API owns the runner bridge.");
  setRunApiOwnership();
}
