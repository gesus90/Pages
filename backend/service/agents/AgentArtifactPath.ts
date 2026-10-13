import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o400;

/** Rejects path syntax before an identifier participates in an artifact filename. */
export function requireArtifactId(id: string): void {
  if (!/^[a-zA-Z0-9-]{1,100}$/u.test(id))
    throw new AgentError("profile_invalid");
}

/**
 * Creates private directories below the agent directory and refuses links.
 *
 * @param root - The agent directory of the instance; created on first use.
 * @param parts - Identifiers and fixed names below the root.
 * @returns The innermost directory.
 *
 * @remarks
 * The root itself is the operator's choice, so a link to another disk is
 * accepted there. Every folder below it must be a real directory, because a
 * planted link would redirect a write outside of the instance.
 */
export async function artifactDirectory(
  root: string,
  parts: readonly string[],
): Promise<string> {
  await mkdir(root, { recursive: true, mode: DIRECTORY_MODE });
  let directory = root;
  for (const part of parts) {
    requireArtifactId(part);
    directory = path.join(directory, part);
    await mkdir(directory, { mode: DIRECTORY_MODE }).catch(
      async (error: unknown) => {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "EEXIST"
        )
          throw error;
        const entry = await lstat(directory);
        if (!entry.isDirectory() || entry.isSymbolicLink())
          throw new AgentError("profile_invalid");
      },
    );
  }
  return directory;
}

/** Tells whether a file or link exists at the path; it never reads the content. */
export async function artifactExists(filename: string): Promise<boolean> {
  return lstat(filename).then(
    () => true,
    () => false,
  );
}

/**
 * Makes a file hold exactly the given content, read-only for its owner.
 *
 * @param filename - Target file inside a directory from {@link artifactDirectory}.
 * @param content - Complete file content.
 *
 * @remarks
 * A file that already holds the content is left untouched, so repeated
 * processing neither changes its time stamp nor races with a reader. Any other
 * content, such as a deleted or tampered file, is replaced atomically.
 */
export async function writeArtifact(
  filename: string,
  content: string,
): Promise<void> {
  const existing = await readFile(filename, "utf8").catch(() => null);
  if (existing === content) return;
  const temporary = path.join(path.dirname(filename), `${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: "wx", mode: FILE_MODE });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}
