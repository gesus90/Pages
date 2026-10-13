import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

/** Rejects path syntax before an identifier participates in an artifact filename. */
export function requireArtifactId(id: string): void {
  if (!/^[a-zA-Z0-9-]{1,100}$/u.test(id))
    throw new AgentError("profile_invalid");
}

/** Creates private directories and refuses symlink traversal beneath the trusted instance directory. */
export async function artifactDirectory(
  root: string,
  parts: readonly string[],
): Promise<string> {
  let directory = root;
  for (const part of parts) {
    requireArtifactId(part);
    directory = path.join(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch(async (error: unknown) => {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      )
        throw error;
      const entry = await lstat(directory);
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw new AgentError("profile_invalid");
    });
  }
  return directory;
}

/** Ensures the hidden .pages directory is a real directory, not a user-controlled link. */
export async function agentArtifactRoot(
  dataDirectory: string,
): Promise<string> {
  const directory = path.join(dataDirectory, ".pages");
  await mkdir(directory, { mode: 0o700 }).catch(async (error: unknown) => {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    )
      throw error;
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new AgentError("profile_invalid");
  });
  return artifactDirectory(directory, ["Agents"]);
}
