import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

import manifest from "../../../package.json";

const runFile = promisify(execFile);
const PNPM_VERSION = manifest.packageManager.replace(/^pnpm@/u, "");
const preparations = new Map<string, Promise<void>>();

/** Environment shared by every native agent of one Pages instance; contains no credentials. */
export function sharedAgentEnvironment(root: string): Record<string, string> {
  return {
    npm_config_manage_package_manager_versions: "false",
    npm_config_global_dir: path.join(root, "pnpm", "global"),
    PNPM_HOME: path.join(root, "pnpm"),
    npm_config_store_dir: path.join(root, "pnpm-store"),
    npm_config_cache_dir: path.join(root, "cache", "pnpm"),
    npm_config_state_dir: path.join(root, "state", "pnpm"),
    npm_config_cache: path.join(root, "cache", "npm"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    PLAYWRIGHT_BROWSERS_PATH: path.join(root, "cache", "ms-playwright"),
  };
}

/** Directory containing the repository-pinned pnpm, ahead of host package-manager shims. */
export function sharedPnpmBin(root: string): string {
  return path.join(root, "pnpm", PNPM_VERSION, "node_modules", ".bin");
}

async function isInstalled(root: string): Promise<boolean> {
  try {
    await access(path.join(sharedPnpmBin(root), "pnpm"), constants.X_OK);
    await access(path.join(root, "pnpm", PNPM_VERSION, "ready"));
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

async function acquireSetup(root: string): Promise<boolean> {
  const lock = path.join(root, "pnpm-setup.lock");
  const deadline = Date.now() + 240_000;
  while (!(await isInstalled(root))) {
    try {
      await mkdir(lock, { mode: 0o700 });
      return true;
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
      const metadata = await lstat(lock).catch(() => null);
      if (metadata && Date.now() - metadata.mtimeMs > 300_000)
        await rm(lock, { recursive: true, force: true });
      if (Date.now() >= deadline)
        throw new Error("Shared pnpm setup timed out");
      await setTimeout(100);
    }
  }
  return false;
}

async function install(root: string): Promise<void> {
  for (const directory of [
    root,
    ...Object.values(sharedAgentEnvironment(root)).filter((entry) =>
      path.isAbsolute(entry),
    ),
  ]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o022) !== 0
    )
      throw new Error("Unsafe shared agent environment");
  }
  if (!(await acquireSetup(root))) return;
  try {
    if (await isInstalled(root)) return;
    await rm(path.dirname(path.dirname(sharedPnpmBin(root))), {
      recursive: true,
      force: true,
    });
    await runFile(
      "npm",
      [
        "install",
        "--prefix",
        path.dirname(path.dirname(sharedPnpmBin(root))),
        `pnpm@${PNPM_VERSION}`,
        "--registry=https://registry.npmjs.org",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
      ],
      {
        timeout: 180_000,
        env: {
          PATH: [
            path.dirname(process.execPath),
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
          ].join(path.delimiter),
          HOME: root,
          ...sharedAgentEnvironment(root),
        },
      },
    );
    await access(path.join(sharedPnpmBin(root), "pnpm"), constants.X_OK);
    await writeFile(
      path.join(root, "pnpm", PNPM_VERSION, "ready"),
      PNPM_VERSION,
      { mode: 0o600 },
    );
  } finally {
    await rm(path.join(root, "pnpm-setup.lock"), {
      recursive: true,
      force: true,
    });
  }
}

/** Provisions pnpm once before a worker enters its sandbox; concurrent owners share the setup lock. */
export async function prepareSharedAgentEnvironment(
  root: string,
): Promise<void> {
  let preparation = preparations.get(root);
  if (!preparation) {
    preparation = install(root).catch((error: unknown) => {
      preparations.delete(root);
      throw error;
    });
    preparations.set(root, preparation);
  }
  await preparation;
}
