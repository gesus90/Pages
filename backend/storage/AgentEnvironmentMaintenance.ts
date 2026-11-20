import type { Dirent } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  PLAN_HOMES_DIRECTORY,
  PLAN_SESSIONS_DIRECTORY,
} from "@/backend/agents/cli/ClaudePlanSessionHome";

import type { AgentEnvironmentRepository } from "@/backend/database/repositories/agent/AgentEnvironmentRepository";

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

const CONNECTION_CACHE_PATHS: readonly (readonly string[])[] = [
  ["data", "pnpm"],
  ["cache", "pnpm"],
  ["cache", "ms-playwright"],
  ["cache", "pages-browser-tests"],
  ["cache", "node"],
  ["cache", "node-gyp"],
  ["cache", "google-chrome-headless"],
  ["cache", "pip"],
  ["cache", "uv"],
  ["cache", "go-build"],
  ["cache", "sccache"],
  ["cache", "yarn"],
  ["cache", "turbo"],
  [".cache", "pip"],
  [".cache", "uv"],
  [".cache", "go-build"],
  [".cache", "sccache"],
  [".cache", "node-gyp"],
  [".cache", "ms-playwright"],
  [".cache", "pnpm"],
  [".cache", "yarn"],
  [".npm", "_cacache"],
  [".npm", "_npx"],
  [".npm", "_logs"],
  [".pages", "tmp"],
  [".cargo", "registry", "cache"],
  [".cargo", "registry", "src"],
  [".cargo", "git", "checkouts"],
  [".cargo", "git", "db"],
  [".gradle", "caches"],
  [".m2", "repository"],
  ["go", "pkg", "mod", "cache"],
];

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

async function removeCachePath(
  home: string,
  segments: readonly string[],
): Promise<void> {
  let current = home;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const name = segments[index];
    const children = await entries(current);
    if (
      !children.some(
        (entry) =>
          entry.name === name && entry.isDirectory() && !entry.isSymbolicLink(),
      )
    )
      return;
    current = path.join(current, name);
  }
  const targetName = segments.at(-1);
  if (!targetName) return;
  const children = await entries(current);
  const match = children.find((entry) => entry.name === targetName);
  if (!match || match.isSymbolicLink()) return;
  await rm(path.join(current, targetName), { recursive: true, force: true });
}

/** Removes obsolete run homes and empties completed plan homes without deleting their stable paths. */
export class AgentEnvironmentMaintenance {
  private readonly root: string;
  private readonly repository: Pick<
    AgentEnvironmentRepository,
    | "maintainPlan"
    | "canRemoveRun"
    | "purgeObsoleteRuns"
    | "maintainConnectionCaches"
  >;

  public constructor(
    root: string,
    repository: Pick<
      AgentEnvironmentRepository,
      | "maintainPlan"
      | "canRemoveRun"
      | "purgeObsoleteRuns"
      | "maintainConnectionCaches"
    >,
  ) {
    this.root = root;
    this.repository = repository;
  }

  /** Sweeps every connection, including connections not used since the run ended. */
  public async run(): Promise<void> {
    await this.repository.purgeObsoleteRuns();
    const agents = path.join(this.root, "agents");
    for (const connection of await entries(agents)) {
      if (!connection.isDirectory()) continue;
      const root = path.join(agents, connection.name);
      await this.repository.maintainConnectionCaches(() =>
        this.connectionCaches(path.join(root, "home")),
      );
      await this.legacyRuns(path.join(root, PLAN_SESSIONS_DIRECTORY));
      await this.planHomes(path.join(root, PLAN_HOMES_DIRECTORY));
    }
  }

  private async connectionCaches(home: string): Promise<void> {
    for (const segments of CONNECTION_CACHE_PATHS)
      await removeCachePath(home, segments);
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
        await this.emptyFolder(folder, name === "claude");
      }
    }
  }

  /** Removes every child of a folder; the Claude folder keeps its credentials file. */
  private async emptyFolder(
    folder: string,
    keepsCredentials: boolean,
  ): Promise<void> {
    for (const entry of await entries(folder)) {
      if (keepsCredentials && entry.name === ".credentials.json") continue;
      await rm(path.join(folder, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
}
