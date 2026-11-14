import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import type { Dirent, Stats } from "node:fs";

/** Reads metadata without following a link; disappearing entries are already clean. */
export async function storageMetadata(location: string): Promise<Stats | null> {
  try {
    return await lstat(location);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

/** Lists a physical directory only; links are never traversed by maintenance. */
export async function storageEntries(directory: string): Promise<Dirent[]> {
  const metadata = await storageMetadata(directory);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) return [];
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
}

/** Resolves an allowlisted relative directory, checking every component for links. */
export async function physicalStorageDirectory(
  root: string,
  relative: string,
): Promise<string | null> {
  let directory = root;
  for (const name of ["", ...relative.split("/")]) {
    directory = path.join(directory, name);
    const metadata = await storageMetadata(directory);
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) return null;
  }
  return directory;
}

/** Credentials, settings and provider databases stay regardless of their age. */
export function isProtectedProviderEntry(name: string): boolean {
  return /(?:\.sqlite(?:[.-].*)?$|\.db(?:[.-].*)?$|\.vscdb(?:[.-].*)?$)|^(?:config|auth|\.credentials|credentials|settings|acp_token|mcp_config|hooks|token|oauth|\.env(?:$|\.))/iu.test(
    name,
  );
}

/** Expires regular transcript files, then removes empty physical directories. */
export async function expireProviderFiles(
  directory: string,
  cutoff: number,
): Promise<void> {
  for (const entry of await storageEntries(directory)) {
    if (isProtectedProviderEntry(entry.name)) continue;
    const location = path.join(directory, entry.name);
    const metadata = await storageMetadata(location);
    if (!metadata || metadata.isSymbolicLink()) continue;
    if (metadata.isDirectory()) await expireProviderFiles(location, cutoff);
    else if (metadata.isFile() && metadata.mtimeMs < cutoff)
      await rm(location, { force: true });
  }
  try {
    await rmdir(directory);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error.code))
    )
      return;
    throw error;
  }
}

/** Counts regular file bytes without following symlinks outside the instance. */
export async function storageBytes(location: string): Promise<number> {
  const metadata = await storageMetadata(location);
  if (!metadata || metadata.isSymbolicLink()) return 0;
  if (metadata.isFile()) return metadata.size;
  if (!metadata.isDirectory()) return 0;
  let bytes = 0;
  for (const entry of await storageEntries(location))
    bytes += await storageBytes(path.join(location, entry.name));
  return bytes;
}
