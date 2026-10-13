import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

import type { CliRunRequest } from "./CliContracts";

/**
 * Hides instance files in a separate mount namespace; chmod alone cannot protect
 * files from a model process running under the same account as the server.
 */
export async function isolateCliPlan(
  request: CliRunRequest,
  protectedDirectory?: string,
): Promise<CliRunRequest> {
  if (protectedDirectory === undefined) return request;
  const binary = "/usr/bin/bwrap";
  try {
    await access(binary, constants.X_OK);
  } catch {
    throw new AgentError("cli_not_executable");
  }
  const [protectedRoot, homeRoot, workingDirectory] = await Promise.all([
    realpath(protectedDirectory),
    realpath(request.home.root),
    realpath(request.workingDirectory ?? request.home.work),
  ]);
  const relative = path.relative(protectedRoot, workingDirectory);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  )
    throw new AgentError("plan_directory_required");
  return {
    ...request,
    file: binary,
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
      "--tmpfs",
      protectedRoot,
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
