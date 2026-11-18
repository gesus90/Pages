import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { CliHome } from "./CliContracts";

/** The folder below `~/.pages/tmp` that holds the homes of usage queries. */
const USAGE_HOME_DIRECTORY = "usage-homes";

/**
 * A private home for one usage query that runs beside a native session.
 * @remarks
 * It holds nothing but a copy of the connection's login file, so the query
 * reads and writes none of the files the session works with.
 */
export interface CliUsageHome {
  readonly home: CliHome;
  /**
   * Ends the query's home.
   * @remarks
   * A login the query refreshed is handed back to the connection when the
   * connection's own file is still the one that was copied; the home is
   * removed in every case. A failure is logged and never reaches the query.
   */
  release(): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function readLogin(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error: unknown) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * Hands a login the query refreshed back to the connection.
 * @remarks
 * The providers rotate the refresh token with each refresh, so a refresh in
 * the copy would leave the connection's file, and with it the session that
 * reads it, holding a token the provider no longer accepts. The copy is
 * therefore written back by an atomic rename, but only when the connection's
 * file is still byte for byte the one that was copied: a file the session or
 * a login wrote meanwhile is newer and stays.
 */
async function adoptRefreshedLogin(
  source: string,
  copy: string,
  original: Buffer,
): Promise<void> {
  const refreshed = await readLogin(copy);
  if (refreshed === null || refreshed.equals(original)) return;
  const current = await readLogin(source);
  if (current === null || !current.equals(original)) return;
  const staging = `${source}.${randomUUID()}.tmp`;
  try {
    await writeFile(staging, refreshed, { mode: 0o600, flag: "wx" });
    await rename(staging, source);
  } catch (error: unknown) {
    await rm(staging, { force: true });
    throw error;
  }
}

/**
 * Prepares a private home with a copy of the connection's login.
 * @param connection - The connection's own home.
 * @param credentialFile - Name of the login file inside the connection's configuration folder.
 * @returns The home of the query and the way to end it.
 * @throws {AgentError} `cli_not_logged_in` when the connection has no login
 * file, `cli_not_executable` when the home cannot be created.
 */
export async function prepareCliUsageHome(
  connection: CliHome,
  credentialFile: string,
): Promise<CliUsageHome> {
  const source = path.join(connection.config, credentialFile);
  const original = await readLogin(source);
  if (original === null) throw new AgentError("cli_not_logged_in");
  const parent = pagesTempDirectory(USAGE_HOME_DIRECTORY);
  let root: string;
  try {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    root = await mkdtemp(path.join(parent, "query-"));
  } catch (error: unknown) {
    logCaughtError("CliUsageHome", error);
    throw new AgentError("cli_not_executable");
  }
  const home: CliHome = {
    root,
    home: path.join(root, "home"),
    config: path.join(root, path.basename(connection.config)),
    work: path.join(root, "work"),
    sharedEnvironment: connection.sharedEnvironment,
  };
  const copy = path.join(home.config, credentialFile);
  try {
    for (const directory of [home.home, home.config, home.work])
      await mkdir(directory, { mode: 0o700 });
    for (const name of ["config", "data", "state"])
      await mkdir(path.join(home.home, name), { mode: 0o700 });
    await writeFile(copy, original, { mode: 0o600, flag: "wx" });
  } catch (error: unknown) {
    logCaughtError("CliUsageHome", error);
    await rm(root, { recursive: true, force: true });
    throw new AgentError("cli_not_executable");
  }
  return {
    home,
    release: async (): Promise<void> => {
      try {
        await adoptRefreshedLogin(source, copy, original);
      } catch (error: unknown) {
        logCaughtError("CliUsageHome", error);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}
