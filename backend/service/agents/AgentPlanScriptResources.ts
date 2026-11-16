import { mkdir, readFile, rm, writeFile, lstat } from "node:fs/promises";
import path from "node:path";

import {
  sharedAgentEnvironment,
  sharedPnpmBin,
} from "@/backend/agents/cli/AgentSharedEnvironment";
import {
  planTemporaryDirectory,
  preparePlanTemporaryDirectory,
} from "@/backend/agents/PlanRunTemporaryDirectory";
import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";
import { correlationEnvironment } from "@/backend/logging/LogCorrelation";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type { PlanTemporaryScope } from "@/backend/agents/PlanRunTemporaryDirectory";

/**
 * The root of the script runtimes in the Pages temporary folder.
 * @returns `~/.pages/tmp/plan-scripts`, which the plan service and the script owner see alike.
 * @remarks
 * The script owner runs in a unit of the account's service manager, which
 * does not see a private `/tmp` of the plan service (`PrivateTmp=true`). A
 * runtime below `tmpdir()` therefore did not exist for the owner, and every
 * script step failed before its process started.
 */
export function scriptRuntimeRoot(): string {
  return pagesTempDirectory("plan-scripts");
}

/** Resolves one private script runtime, shared with its independent capture owner. */
export function scriptRuntimeDirectory(
  instanceId: string,
  scope?: PlanTemporaryScope,
): string {
  if (!/^[a-f0-9-]{36}$/u.test(instanceId))
    throw new Error("Invalid script instance");
  return scope
    ? path.join(planTemporaryDirectory(scope), `resources-${instanceId}`)
    : path.join(scriptRuntimeRoot(), `pages-plan-script-${instanceId}`);
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
  scope?: PlanTemporaryScope,
): Promise<string> {
  const directory = scriptRuntimeDirectory(instanceId, scope);
  if (scope) await preparePlanTemporaryDirectory(scope);
  else await prepareScriptRuntimeRoot();
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
  try {
    await writeFile(path.join(directory, "owner"), instanceId, {
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(path.join(directory, "script.cjs"), content, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}

/** Removes a private runtime directory only after checking its location, ownership and marker. */
export async function removeScriptResources(
  instanceId: string,
  scope?: PlanTemporaryScope,
): Promise<void> {
  const directory = scriptRuntimeDirectory(instanceId, scope);
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
  readonly temporaryDirectory?: string;
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
    TMPDIR: input.temporaryDirectory ?? directory,
    ...(input.temporaryDirectory
      ? {
          TEMP: input.temporaryDirectory,
          TMP: input.temporaryDirectory,
          NODE_COMPILE_CACHE: path.join(
            input.temporaryDirectory,
            "node-compile-cache",
          ),
        }
      : {}),
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
