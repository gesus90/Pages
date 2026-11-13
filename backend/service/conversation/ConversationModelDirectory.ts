import { lstat, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";

/** The folder of the short-lived working directories of observer and decision sessions. */
export const CONVERSATION_MODEL_DIRECTORY_NAME = "observer-sessions";

/**
 * The root of observer and decision working directories next to Pica's own.
 *
 * @param picaWorkspaceRoot - The root of Pica's working directories.
 * @returns A sibling folder, outside the data and agent folders the isolation hides.
 *
 * @remarks
 * A session runs in a worker unit of the account's service manager, which
 * does not see a private `/tmp` of the Pages service (`PrivateTmp=true`). A
 * directory below `tmpdir()` therefore did not exist for the session and
 * every observer start failed (PAGE-340).
 */
export function conversationModelRoot(picaWorkspaceRoot: string): string {
  return path.join(
    path.dirname(picaWorkspaceRoot),
    CONVERSATION_MODEL_DIRECTORY_NAME,
  );
}

/**
 * Creates one private working directory for a single model session.
 *
 * @param root - See {@link conversationModelRoot}.
 * @param prefix - The start of the directory name.
 * @throws {Error} When the root is a link or not the server account's own folder.
 */
export async function createConversationModelDirectory(
  root: string,
  prefix: string,
): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const facts = await lstat(root);
  const owner = process.getuid?.();
  if (
    facts.isSymbolicLink() ||
    !facts.isDirectory() ||
    (owner !== undefined && facts.uid !== owner)
  )
    throw new Error("The observer working root is not a private directory.");
  return mkdtemp(path.join(root, prefix));
}
