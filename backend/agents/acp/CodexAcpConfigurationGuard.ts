import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { parse } from "smol-toml";

import { logCaughtError } from "@/backend/logging/Logger";

const CONFIGURATION_FILE = "config.toml";

// Codex records only a few short lines per folder it ran in; a larger file is not that record.
const MAXIMUM_TRUST_RECORD_BYTES = 256 * 1024;

const TRUST_LEVELS: ReadonlySet<unknown> = new Set(["trusted", "untrusted"]);

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (caughtError: unknown) {
    logCaughtError("CodexAcpConfigurationGuard", caughtError);

    return false;
  }
}

function isTable(value: unknown): value is Readonly<Record<string, unknown>> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isFolderTrustRecord(record: unknown): boolean {
  if (!isTable(record)) return false;
  const names = Object.keys(record);
  return (
    names.length === 1 &&
    names[0] === "trust_level" &&
    TRUST_LEVELS.has(Reflect.get(record, "trust_level"))
  );
}

function holdsOnlyFolderTrust(document: unknown): boolean {
  if (!isTable(document)) return false;
  return Object.entries(document).every(
    ([name, folders]) =>
      name === "projects" &&
      isTable(folders) &&
      Object.values(folders).every(isFolderTrustRecord),
  );
}

/**
 * Whether a configuration file holds nothing but the folder trust Codex records itself.
 * @remarks
 * Codex writes `[projects."<folder>"]` with a `trust_level` into the
 * `config.toml` of its home folder whenever a session ran in a new folder, so
 * every connection that already served a Codex run holds such a file. It names
 * no MCP server, hook, provider or setting, so it cannot change a session. A
 * file that cannot be read or parsed, or that holds anything else, is not it.
 */
async function isFolderTrustRecordFile(file: string): Promise<boolean> {
  try {
    const { size } = await stat(file);
    if (size > MAXIMUM_TRUST_RECORD_BYTES) return false;
    return holdsOnlyFolderTrust(parse(await readFile(file, "utf8")));
  } catch (caughtError: unknown) {
    logCaughtError("CodexAcpConfigurationGuard", caughtError);

    return false;
  }
}

/**
 * The folders whose `.codex` configuration Codex reads for a working directory.
 * @remarks
 * Codex treats the nearest folder with `.git` as the project root and reads
 * every folder from there down to the working directory; without a root it
 * reads the working directory alone. The adapter trusts the working
 * directory, so these files would apply.
 */
async function projectFolders(workspace: string): Promise<readonly string[]> {
  const folders = [workspace];
  let folder = workspace;
  while (!(await exists(path.join(folder, ".git")))) {
    const parent = path.dirname(folder);
    if (parent === folder) return [workspace];
    folders.push(parent);
    folder = parent;
  }
  return folders;
}

/**
 * Finds the configuration file a connection's Codex folder holds, which Pages did not write.
 * @param codexHome - The Codex folder of the connection's credential folder.
 * @returns The file, or `null` when the folder has none or only the folder
 * trust Codex records itself. The file is read but never changed or removed.
 */
export async function findUnmanagedCodexHomeConfiguration(
  codexHome: string,
): Promise<string | null> {
  const file = path.join(codexHome, CONFIGURATION_FILE);
  if (!(await exists(file))) return null;
  return (await isFolderTrustRecordFile(file)) ? null : file;
}

/**
 * Finds a Codex configuration file that Pages did not write.
 * @param codexHome - The Codex folder of the connection's credential folder.
 * @param workspace - The working directory of the session.
 * @returns The first such file, or `null` when the session runs with the
 * configuration of Pages alone.
 * @remarks
 * Pages passes every setting of a session above all configuration files, but
 * a file could still add MCP servers, hooks or providers that the stored
 * agent does not name. The legacy runner ignored such files; the adapter
 * cannot, so a session refuses to start while one exists.
 */
export async function findUnmanagedCodexConfiguration(
  codexHome: string,
  workspace: string,
): Promise<string | null> {
  const home = await findUnmanagedCodexHomeConfiguration(codexHome);
  if (home !== null) return home;
  for (const folder of await projectFolders(workspace)) {
    const file = path.join(folder, ".codex", CONFIGURATION_FILE);
    if (await exists(file)) return file;
  }
  return null;
}
