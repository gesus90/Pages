import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import {
  sharedAgentEnvironment,
  sharedPnpmBin,
} from "@/backend/agents/cli/AgentSharedEnvironment";

import {
  physicalStorageDirectory,
  storageEntries,
  storageMetadata,
} from "./StorageFiles";

const runFile = promisify(execFile);
const require = createRequire(import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const browsersSchema = z.object({
  browsers: z.array(
    z.object({
      name: z.string().regex(/^[a-z][a-z-]*$/u),
      revision: z.string().regex(/^\d+$/u),
      revisionOverrides: z
        .record(z.string(), z.string().regex(/^\d+$/u))
        .optional(),
    }),
  ),
});

/** Prunes with the instance's pinned executable and shared store, never a host pnpm shim. */
export async function pruneSharedStore(root: string): Promise<void> {
  if (!(await physicalStorageDirectory(root, "pnpm"))) return;
  const executable = path.join(sharedPnpmBin(root), "pnpm");
  if (!(await storageMetadata(executable))) return;
  await runFile(executable, ["store", "prune"], {
    cwd: root,
    timeout: 180_000,
    maxBuffer: 1024 * 1024,
    env: {
      HOME: root,
      PATH: [
        sharedPnpmBin(root),
        path.dirname(process.execPath),
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ].join(path.delimiter),
      ...sharedAgentEnvironment(root),
    },
  });
}

async function requiredBrowsers(): Promise<ReadonlySet<string>> {
  const packagePath = require.resolve("playwright-core/package.json");
  const installed = z
    .object({ version: z.string() })
    .parse(JSON.parse(await readFile(packagePath, "utf8")));
  const lockfile = await readFile(
    path.join(REPOSITORY_ROOT, "pnpm-lock.yaml"),
    "utf8",
  );
  const locked =
    /\n {6}playwright-core:\r?\n {8}specifier: [^\n]+\r?\n {8}version: ([^\s(]+)/u.exec(
      lockfile,
    )?.[1];
  if (locked !== installed.version)
    throw new Error(
      "Browser cleanup needs the lockfile's installed playwright-core",
    );
  const manifest = browsersSchema.parse(
    JSON.parse(
      await readFile(
        path.join(path.dirname(packagePath), "browsers.json"),
        "utf8",
      ),
    ),
  );
  const required = new Set<string>();
  for (const browser of manifest.browsers) {
    // Keep overrides for all platforms, including caches moved between hosts.
    for (const revision of [
      browser.revision,
      ...Object.values(browser.revisionOverrides ?? {}),
    ])
      required.add(`${browser.name.replaceAll("-", "_")}-${revision}`);
  }
  return required;
}

/** Removes only aged browser-revision folders; .links and unrelated directories stay. */
export async function pruneOldBrowsers(
  root: string,
  cutoff: number,
): Promise<void> {
  const directory = await physicalStorageDirectory(root, "cache/ms-playwright");
  if (!directory) return;
  const required = await requiredBrowsers();
  for (const entry of await storageEntries(directory)) {
    if (
      !entry.isDirectory() ||
      !/^(?:chromium(?:_headless_shell|_tip_of_tree(?:_headless_shell)?)?|firefox|webkit|ffmpeg|winldd|android)-\d+$/u.test(
        entry.name,
      ) ||
      required.has(entry.name)
    )
      continue;
    const location = path.join(directory, entry.name);
    const metadata = await storageMetadata(location);
    if (
      metadata?.isDirectory() &&
      !metadata.isSymbolicLink() &&
      metadata.mtimeMs < cutoff
    )
      await rm(location, { recursive: true, force: true });
  }
}
