import { mkdir, readFile, rm, writeFile, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  sharedAgentEnvironment,
  sharedPnpmBin,
} from "@/backend/agents/cli/AgentSharedEnvironment";
import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";
import { correlationEnvironment } from "@/backend/logging/LogCorrelation";

/**
 * The root of the script runtimes in the account's home.
 *
 * @returns A folder the plan service and the script owner see alike.
 *
 * @remarks
 * The script owner runs in a unit of the account's service manager, which
 * does not see a private `/tmp` of the plan service (`PrivateTmp=true`). A
 * runtime below `tmpdir()` therefore did not exist for the owner, and every
 * script step failed before its process started.
 */
export function scriptRuntimeRoot(): string {
  return path.join(os.homedir(), ".local", "state", "pages", "plan-scripts");
}

/** Resolves one private script runtime, shared with its independent capture owner. */
export function scriptRuntimeDirectory(instanceId: string): string {
  if (!/^[a-f0-9-]{36}$/u.test(instanceId))
    throw new Error("Invalid script instance");
  return path.join(scriptRuntimeRoot(), `pages-plan-script-${instanceId}`);
}

/** Creates the root of the script runtimes and refuses one that is not the account's private folder. */
async function prepareScriptRuntimeRoot(): Promise<void> {
  const root = scriptRuntimeRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const metadata = await lstat(root);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.()
  )
    throw new Error("The script runtime root is not a private directory");
}

/** Creates only this attempt's private source and home, outside the working copy. */
export async function createScriptResources(
  instanceId: string,
  content: string,
): Promise<string> {
  const directory = scriptRuntimeDirectory(instanceId);
  await prepareScriptRuntimeRoot();
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid?.() ||
      (await readFile(path.join(directory, "owner"), "utf8")) !== instanceId ||
      (await readFile(path.join(directory, "script.cjs"), "utf8")) !== content
    )
      throw new Error(
        "Existing script resources do not match the saved attempt",
      );
    return directory;
  }
  await writeFile(path.join(directory, "owner"), instanceId, {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(path.join(directory, "script.cjs"), content, {
    mode: 0o600,
    flag: "wx",
  });
  return directory;
}

/** Removes a private runtime directory only after checking its location, ownership and marker. */
export async function removeScriptResources(instanceId: string): Promise<void> {
  const directory = scriptRuntimeDirectory(instanceId);
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.()
  )
    throw new Error("Script resource ownership could not be confirmed");
  if ((await readFile(path.join(directory, "owner"), "utf8")) !== instanceId)
    throw new Error("Script resource marker could not be confirmed");
  await rm(directory, { recursive: true });
}

/** Explicit environment allowlist: no inherited provider, gateway, proxy or login credentials. */
export function scriptEnvironment(input: {
  readonly directory: string;
  readonly interpreter: string;
  readonly instanceId: string;
  readonly sharedEnvironment?: string;
}): Record<string, string> {
  const { directory, sharedEnvironment } = input;
  return {
    ...(sharedEnvironment
      ? sharedAgentEnvironment(sharedEnvironment)
      : { XDG_CACHE_HOME: path.join(directory, "cache") }),
    PATH: [
      ...new Set([
        ...(sharedEnvironment
          ? [
              sharedPnpmBin(sharedEnvironment),
              path.join(sharedEnvironment, "pnpm"),
            ]
          : []),
        path.dirname(input.interpreter),
        path.dirname(process.execPath),
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ]),
    ].join(path.delimiter),
    HOME: directory,
    TMPDIR: directory,
    XDG_CONFIG_HOME: path.join(directory, "config"),
    XDG_DATA_HOME: path.join(directory, "data"),
    XDG_STATE_HOME: path.join(directory, "state"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    [RUN_INSTANCE_VARIABLE]: input.instanceId,
    ...correlationEnvironment(),
  };
}
