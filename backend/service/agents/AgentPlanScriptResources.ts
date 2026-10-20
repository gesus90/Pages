import { mkdir, readFile, rm, writeFile, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";

function runtimeDirectory(instanceId: string): string {
  if (!/^[a-f0-9-]{36}$/u.test(instanceId))
    throw new Error("Invalid script instance");
  return path.join(os.tmpdir(), `pages-plan-script-${instanceId}`);
}

/** Creates only this attempt's private source and home, outside the working copy. */
export async function createScriptResources(
  instanceId: string,
  content: string,
): Promise<string> {
  const directory = runtimeDirectory(instanceId);
  await mkdir(directory, { mode: 0o700 });
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
  const directory = runtimeDirectory(instanceId);
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
}): Record<string, string> {
  const { directory } = input;
  return {
    PATH: [
      ...new Set([
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
    XDG_CACHE_HOME: path.join(directory, "cache"),
    XDG_DATA_HOME: path.join(directory, "data"),
    XDG_STATE_HOME: path.join(directory, "state"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    [RUN_INSTANCE_VARIABLE]: input.instanceId,
  };
}
