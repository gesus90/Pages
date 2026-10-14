import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { promisify } from "node:util";

import { AgentError } from "@/backend/error/AgentErrors";
import { containsWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";

import type { CliSessionRequest } from "./CliContracts";

const BUBBLEWRAP = "/usr/bin/bwrap";
const TRUE_BINARY = "/usr/bin/true";
const execFileAsync = promisify(execFile);

/**
 * Proves that bubblewrap starts a namespace for this account on this host.
 *
 * @param run - Starts a program and fails with the program; defaults to a real process.
 * @returns Whether bubblewrap is installed and a throw-away namespace starts.
 *
 * @remarks
 * An installed binary is not enough: containers and hardened kernels refuse
 * unprivileged namespaces, and a CLI run would then fail for a reason nobody
 * could see.
 */
export async function probeBubblewrap(
  run: (file: string, args: readonly string[]) => Promise<unknown> = (
    file,
    args,
  ) => execFileAsync(file, [...args], { timeout: 10_000 }),
): Promise<boolean> {
  try {
    await access(BUBBLEWRAP, constants.X_OK);
    await run(BUBBLEWRAP, [
      "--ro-bind",
      "/",
      "/",
      "--unshare-pid",
      "--proc",
      "/proc",
      "--",
      TRUE_BINARY,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hides the instance folders from CLI runs in a separate mount namespace.
 *
 * @remarks
 * File modes alone cannot protect `AGENT.md` and the run records from a model
 * process that runs under the account of the server. The namespace makes the
 * system read-only, leaves only the working copy and the credential home
 * writable, and replaces every protected folder with an empty one. A
 * read-only session gets its working copy read-only as well. The prompt
 * still travels over stdin, never through the argument list. A host where
 * bubblewrap does not work relies on the sandbox of the CLI itself and on
 * working copies being kept apart from the instance folders when they are
 * registered.
 */
export class CliPlanIsolation {
  private readonly protectedDirectories: readonly string[];
  private readonly probe: () => Promise<boolean>;
  private availability: Promise<boolean> | null = null;

  /**
   * Creates the isolation of one server process.
   *
   * @param protectedDirectories - Folders that must stay out of reach, such as the data and agent folders.
   * @param probe - Decides once whether bubblewrap works here; defaults to {@link probeBubblewrap}.
   */
  public constructor(
    protectedDirectories: readonly string[],
    probe: () => Promise<boolean> = probeBubblewrap,
  ) {
    this.protectedDirectories = protectedDirectories;
    this.probe = probe;
  }

  /**
   * Wraps a run in bubblewrap.
   *
   * @param request - The run as it would start without isolation.
   * @returns The wrapped run, or `null` when bubblewrap does not work on this host.
   * @throws {AgentError} `workspace_path_outside_roots` when the working
   * directory lies within a protected folder.
   */
  public async isolate(
    request: CliSessionRequest,
  ): Promise<CliSessionRequest | null> {
    this.availability ??= this.probe();
    if (!(await this.availability)) return null;
    const [homeRoot, workingDirectory] = await Promise.all([
      realpath(request.home.root),
      realpath(request.workingDirectory),
    ]);
    // A folder that does not exist yet has nothing to hide.
    const resolved = await Promise.all(
      this.protectedDirectories.map((entry) =>
        realpath(entry).catch(() => null),
      ),
    );
    const hidden = resolved.filter((entry): entry is string => entry !== null);
    if (hidden.some((entry) => containsWorkspacePath(entry, workingDirectory)))
      throw new AgentError("workspace_path_outside_roots");
    return {
      ...request,
      file: BUBBLEWRAP,
      toolFile: request.file,
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
        request.isWorkingDirectoryReadOnly === true ? "--ro-bind" : "--bind",
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
}
