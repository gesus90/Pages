import type { Dirent } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  PLAN_HOMES_DIRECTORY,
  PLAN_SESSIONS_DIRECTORY,
} from "@/backend/agents/cli/ClaudePlanSessionHome";

import type { AgentEnvironmentRepository } from "@/backend/database/repositories/agent/AgentEnvironmentRepository";

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

async function entries(directory: string): Promise<Dirent[]> {
  try {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return [];
    return await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
}

/** Removes obsolete run homes and empties completed plan homes without deleting their stable paths. */
export class AgentEnvironmentMaintenance {
  private readonly root: string;
  private readonly repository: Pick<
    AgentEnvironmentRepository,
    "maintainPlan" | "canRemoveRun"
  >;

  public constructor(
    root: string,
    repository: Pick<
      AgentEnvironmentRepository,
      "maintainPlan" | "canRemoveRun"
    >,
  ) {
    this.root = root;
    this.repository = repository;
  }

  /** Sweeps every connection, including connections not used since the run ended. */
  public async run(): Promise<void> {
    const agents = path.join(this.root, "agents");
    for (const connection of await entries(agents)) {
      if (!connection.isDirectory()) continue;
      const root = path.join(agents, connection.name);
      await this.legacyRuns(path.join(root, PLAN_SESSIONS_DIRECTORY));
      await this.planHomes(path.join(root, PLAN_HOMES_DIRECTORY));
    }
  }

  private async legacyRuns(root: string): Promise<void> {
    for (const entry of await entries(root)) {
      if (!UUID.test(entry.name) || !entry.isDirectory()) continue;
      if (await this.repository.canRemoveRun(entry.name))
        await rm(path.join(root, entry.name), { recursive: true, force: true });
    }
  }

  private async planHomes(root: string): Promise<void> {
    for (const plan of await entries(root)) {
      if (!UUID.test(plan.name) || !plan.isDirectory()) continue;
      const directory = path.join(root, plan.name);
      await this.repository.maintainPlan(plan.name, async (disposition) => {
        if (disposition === "remove") {
          await rm(directory, { recursive: true, force: true });
        } else if (disposition === "empty") {
          await this.emptyScopes(directory);
        }
      });
    }
  }

  private async emptyScopes(directory: string): Promise<void> {
    for (const scope of await entries(directory)) {
      if (!scope.isDirectory() || !/^[a-f0-9]{64}$/u.test(scope.name)) continue;
      const root = path.join(directory, scope.name);
      for (const name of ["home", "claude", "work"]) {
        const folder = path.join(root, name);
        const children = await entries(root);
        if (
          !children.some((entry) => entry.name === name && entry.isDirectory())
        )
          continue;
        for (const entry of await entries(folder)) {
          if (name === "claude" && entry.name === ".credentials.json") continue;
          await rm(path.join(folder, entry.name), {
            recursive: true,
            force: true,
          });
        }
      }
    }
  }
}
