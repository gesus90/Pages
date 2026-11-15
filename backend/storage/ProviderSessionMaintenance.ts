import { rm } from "node:fs/promises";
import path from "node:path";

import {
  expireProviderFiles,
  isProtectedProviderEntry,
  physicalStorageDirectory,
  storageEntries,
  storageMetadata,
} from "./StorageFiles";

const TRANSCRIPT_DIRECTORIES = [
  "codex/sessions",
  "claude/projects",
  "opencode/opencode/storage",
] as const;
const ANTIGRAVITY_HISTORY =
  /^(?:sessions?|history|histories|conversations?)(?:$|[-_.])/iu;

async function antigravityHistory(
  directory: string,
  cutoff: number,
): Promise<void> {
  for (const entry of await storageEntries(directory)) {
    if (isProtectedProviderEntry(entry.name)) continue;
    const location = path.join(directory, entry.name);
    const metadata = await storageMetadata(location);
    if (!metadata || metadata.isSymbolicLink()) continue;
    if (metadata.isDirectory()) {
      if (ANTIGRAVITY_HISTORY.test(entry.name))
        await expireProviderFiles(location, cutoff);
      else await antigravityHistory(location, cutoff);
    } else if (
      metadata.isFile() &&
      ANTIGRAVITY_HISTORY.test(entry.name) &&
      metadata.mtimeMs < cutoff
    ) {
      await rm(location, { force: true });
    }
  }
}

/** Sweeps only the provider transcript paths and the obsolete OpenCode pnpm store, while idle. */
export async function maintainProviderSessions(
  root: string,
  cutoff: number,
): Promise<void> {
  const agents = await physicalStorageDirectory(root, "agents");
  if (!agents) return;
  for (const connection of await storageEntries(agents)) {
    if (!connection.isDirectory() || connection.isSymbolicLink()) continue;
    const directory = path.join(agents, connection.name);
    for (const relative of TRANSCRIPT_DIRECTORIES) {
      const transcripts = await physicalStorageDirectory(directory, relative);
      if (transcripts) await expireProviderFiles(transcripts, cutoff);
    }
    const antigravity = await physicalStorageDirectory(
      directory,
      "antigravity/antigravity-acp",
    );
    if (antigravity) await antigravityHistory(antigravity, cutoff);
    const legacyStore = await physicalStorageDirectory(
      directory,
      "opencode/pnpm",
    );
    if (legacyStore) await rm(legacyStore, { recursive: true, force: true });
  }
}
