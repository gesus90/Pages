import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { promisify } from "node:util";

import { AgentError } from "@/backend/error/AgentErrors";
import { containsWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";
import { logCaughtError } from "@/backend/logging/Logger";

import type { CliSessionRequest } from "./CliContracts";

const BUBBLEWRAP = "/usr/bin/bwrap";
const TRUE_BINARY = "/usr/bin/true";
/** A failed probe is repeated after this long, so installing bubblewrap needs no restart. */
const RETRY_FAILED_PROBE_MS = 60_000;
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
  } catch (caughtError: unknown) {
    logCaughtError("CliPlanIsolation", caughtError);

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
 * writable, and replaces every protected folder with an empty one. The
 * account's runtime folder is replaced as well, so no socket of its service
 * manager, session bus or SSH agent is reachable from inside. A
 * read-only session gets its working copy read-only as well. The prompt
 * still travels over stdin, never through the argument list. A host where
 * bubblewrap does not work relies on the sandbox of the CLI itself and on
 * working copies being kept apart from the instance folders when they are
 * registered.
 */
export class CliPlanIsolation {
  private readonly protectedDirectories: readonly string[];
  private readonly probe: () => Promise<boolean>;
  private readonly readOnlyDirectories: readonly string[];
  private readonly hiddenDirectories: readonly string[];
  private result: { readonly isWorking: boolean; readonly at: number } | null =
    null;
  private probing: Promise<boolean> | null = null;

  /**
   * Creates the isolation of one server process.
   *
   * @param protectedDirectories - Folders that must stay out of reach, such as the data and agent folders.
   * @param probe - Decides whether bubblewrap works here; defaults to {@link probeBubblewrap}.
   * A positive answer is kept for the life of the server, a negative one for a minute.
   */
  public constructor(
    protectedDirectories: readonly string[],
    probe: () => Promise<boolean> = probeBubblewrap,
    mounts: {
      readonly readOnlyDirectories?: readonly string[];
      readonly hiddenDirectories?: readonly string[];
    } = {},
  ) {
    this.protectedDirectories = protectedDirectories;
    this.probe = probe;
    this.readOnlyDirectories = mounts.readOnlyDirectories ?? [];
    this.hiddenDirectories = mounts.hiddenDirectories ?? [];
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
    if (!(await this.isAvailable())) return null;
    const [homeRoot, workingDirectory] = await Promise.all([
      realpath(request.home.root),
      realpath(request.workingDirectory),
    ]);
    // A folder that does not exist yet has nothing to hide.
    const resolved = await Promise.all(
      this.protectedDirectories.map((entry) =>
        realpath(entry).catch((caughtError: unknown) => {
          logCaughtError("CliPlanIsolation", caughtError);
          return null;
        }),
      ),
    );
    const readOnly = await this.existingDirectories(this.readOnlyDirectories);
    const readOnlyFiles = await this.existingDirectories(
      request.readOnlyFiles ?? [],
    );
    const privateHomes = await this.existingDirectories([
      ...this.hiddenDirectories,
      // The runtime folder of the account holds its service manager's bus and its SSH agent.
      ...(process.getuid ? [`/run/user/${process.getuid()}`] : []),
    ]);
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
        ...privateHomes.flatMap((entry) => ["--tmpfs", entry]),
        request.isWorkingDirectoryReadOnly === true ? "--ro-bind" : "--bind",
        workingDirectory,
        workingDirectory,
        ...[...new Set(hidden)]
          .sort((first, second) => first.length - second.length)
          .flatMap((entry) => ["--tmpfs", entry]),
        ...readOnly.flatMap((entry) => ["--ro-bind", entry, entry]),
        ...readOnlyFiles.flatMap((entry) => ["--ro-bind", entry, entry]),
        "--bind",
        homeRoot,
        homeRoot,
        ...(request.credentialDirectory
          ? [
              "--ro-bind",
              request.credentialDirectory,
              request.credentialDirectory,
            ]
          : []),
        "--chdir",
        workingDirectory,
        "--",
        request.file,
        ...request.arguments,
      ],
    };
  }

  private async existingDirectories(
    directories: readonly string[],
  ): Promise<readonly string[]> {
    const resolved = await Promise.all(
      directories.map((entry) => realpath(entry).catch(() => null)),
    );
    return resolved.filter((entry): entry is string => entry !== null);
  }

  private async isAvailable(): Promise<boolean> {
    const { result } = this;
    if (
      result !== null &&
      (result.isWorking || Date.now() - result.at < RETRY_FAILED_PROBE_MS)
    )
      return result.isWorking;
    this.probing ??= this.runProbe();
    return this.probing;
  }

  private async runProbe(): Promise<boolean> {
    try {
      const isWorking = await this.probe();
      this.result = { isWorking, at: Date.now() };
      return isWorking;
    } finally {
      this.probing = null;
    }
  }
}
