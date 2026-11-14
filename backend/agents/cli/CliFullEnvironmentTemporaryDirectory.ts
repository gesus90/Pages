import path from "node:path";

import { planTemporaryEnvironment } from "../PlanRunTemporaryDirectory";

import { sshConfigOverlayArguments } from "./CliSshConfigOverlay";

import type { CliSessionRequest } from "./CliContracts";

/** Keeps the owner's complete host access while giving this plan its own disk-backed /tmp and PID lifetime. */
export async function isolateFullEnvironmentTemporaryDirectory(
  request: CliSessionRequest,
): Promise<CliSessionRequest> {
  if (!request.temporaryDirectory) return request;
  return {
    ...request,
    file: "/usr/bin/bwrap",
    toolFile: request.file,
    environment: { ...request.environment, ...planTemporaryEnvironment() },
    arguments: await fullEnvironmentTemporaryArguments({
      temporaryDirectory: request.temporaryDirectory,
      workingDirectory: request.workingDirectory,
      file: request.file,
      arguments: request.arguments,
    }),
  };
}

/** Wraps owner commands, including login-shell preparation, in the same temporary mount. */
export async function fullEnvironmentTemporaryArguments(request: {
  readonly temporaryDirectory: string;
  readonly workingDirectory: string;
  readonly file: string;
  readonly arguments: readonly string[];
}): Promise<readonly string[]> {
  const sshConfigOverlay = await sshConfigOverlayArguments(
    path.join(path.dirname(request.temporaryDirectory), "ssh_config.d"),
  );
  return [
    "--die-with-parent",
    "--unshare-pid",
    "--new-session",
    "--bind",
    "/",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--bind",
    request.temporaryDirectory,
    "/tmp",
    ...sshConfigOverlay,
    "--chdir",
    request.workingDirectory,
    "--",
    request.file,
    ...request.arguments,
  ];
}
