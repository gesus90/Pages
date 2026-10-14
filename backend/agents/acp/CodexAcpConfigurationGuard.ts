import { access } from "node:fs/promises";
import path from "node:path";

const CONFIGURATION_FILE = "config.toml";

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The folders whose `.codex` configuration Codex reads for a working directory.
 *
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
 * Finds a Codex configuration file that Pages did not write.
 *
 * @param codexHome - The Codex folder of the connection's credential folder.
 * @param workspace - The working directory of the session.
 * @returns The first such file, or `null` when the session runs with the
 * configuration of Pages alone.
 *
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
  const candidates = [
    path.join(codexHome, CONFIGURATION_FILE),
    ...(await projectFolders(workspace)).map((folder) =>
      path.join(folder, ".codex", CONFIGURATION_FILE),
    ),
  ];
  for (const file of candidates) if (await exists(file)) return file;
  return null;
}
