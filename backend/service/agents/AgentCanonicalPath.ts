import { realpath } from "node:fs/promises";
import path from "node:path";

import { logCaughtError } from "@/backend/logging/Logger";

/** Resolves existing ancestors when the protected directory has not been created yet. */
export async function canonicalProspectivePath(
  directory: string,
): Promise<string> {
  try {
    return await realpath(directory);
  } catch (error: unknown) {
    if (!isMissingPath(error)) {
      logCaughtError("AgentCanonicalPath", error);
      throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw error;
    return path.join(
      await canonicalProspectivePath(parent),
      path.basename(directory),
    );
  }
}

/** Missing entries alone may be created; unreadable ones must fail closed. */
export function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
