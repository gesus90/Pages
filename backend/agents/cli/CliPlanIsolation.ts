import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";

import { AgentError } from "@/backend/error/AgentErrors";
import { containsWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";

import type { CliRunRequest } from "./CliContracts";

const BUBBLEWRAP = "/usr/bin/bwrap";

async function isBubblewrapInstalled(): Promise<boolean> {
  try {
    await access(BUBBLEWRAP, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hides the instance folders from a CLI run in a separate mount namespace.
 *
 * @param request - The run as it would start without isolation.
 * @param protectedDirectories - Folders that must stay out of reach, such as the data and agent folders.
 * @returns The run wrapped in bubblewrap, or `null` when bubblewrap is not installed.
 * @throws {AgentError} `workspace_path_outside_roots` when the working
 * directory lies within a protected folder.
 *
 * @remarks
 * File modes alone cannot protect `AGENT.md` from a model process that runs
 * under the account of the server. The namespace makes the system read-only,
 * leaves only the working copy and the credential home writable, and replaces
 * every protected folder with an empty one. The prompt still travels over
 * stdin, never through the argument list. A host without bubblewrap relies on
 * the sandbox of the CLI itself and on working copies being kept apart from
 * the instance folders when they are registered.
 */
export async function isolateCliPlan(
  request: CliRunRequest,
  protectedDirectories: readonly string[],
): Promise<CliRunRequest | null> {
  if (!(await isBubblewrapInstalled())) return null;
  const [homeRoot, workingDirectory] = await Promise.all([
    realpath(request.home.root),
    realpath(request.workingDirectory ?? request.home.work),
  ]);
  // A folder that does not exist yet has nothing to hide.
  const resolved = await Promise.all(
    protectedDirectories.map((entry) => realpath(entry).catch(() => null)),
  );
  const hidden = resolved.filter((entry): entry is string => entry !== null);
  if (hidden.some((entry) => containsWorkspacePath(entry, workingDirectory)))
    throw new AgentError("workspace_path_outside_roots");
  return {
    ...request,
    file: BUBBLEWRAP,
    arguments: [
      "--die-with-parent",
      "--unshare-pid",
      "--new-session",
      "--ro-bind",
      "/",
      "/",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--bind",
      workingDirectory,
      workingDirectory,
      ...hidden.flatMap((entry) => ["--tmpfs", entry]),
      "--bind",
      homeRoot,
      homeRoot,
      "--chdir",
      workingDirectory,
      "--",
      request.file,
      ...request.arguments,
    ],
  };
}
