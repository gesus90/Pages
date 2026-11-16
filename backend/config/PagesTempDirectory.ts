import os from "node:os";
import path from "node:path";

/**
 * The one folder for temporary files of Pages: `~/.pages/tmp`.
 * @param parts - Optional subfolders below it, one per kind of temporary file.
 * @returns The absolute path; nothing is created.
 * @remarks
 * The Pages services run with a private `/tmp` (`PrivateTmp=true`), while
 * script owners, agents and worker units run in the account's service
 * manager and see the host `/tmp`. A file below `tmpdir()` therefore does not
 * exist for the other side. Every temporary file that more than one process
 * must see belongs here, in its own subfolder.
 */
export function pagesTempDirectory(...parts: readonly string[]): string {
  return path.join(os.homedir(), ".pages", "tmp", ...parts);
}
