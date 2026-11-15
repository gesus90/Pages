import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import type { AgentToolStorage } from "./AgentToolContracts";

/** Coordinates shared installation scratch space and owns disposable probe files. */
export class AgentToolRunFiles {
  private static readonly installations = new Map<string, Promise<void>>();
  private static readonly temporaryDirectories = new Set<string>();
  private readonly files: AgentToolStorage;

  public constructor(files: AgentToolStorage) {
    this.files = files;
  }

  /** Removes legacy loose files and abandoned run directories before startup checks. */
  public async initialize(): Promise<void> {
    await this.files.home();
    const probe = path.join(this.files.root, "probe");
    for (const entry of await readdir(probe, { withFileTypes: true })) {
      if (entry.isDirectory()) continue;
      await rm(path.join(probe, entry.name), { force: true });
    }
    const temporaryRoot = await this.temporaryRoot();
    for (const entry of await readdir(temporaryRoot, { withFileTypes: true })) {
      const directory = path.join(temporaryRoot, entry.name);
      if (AgentToolRunFiles.temporaryDirectories.has(directory)) continue;
      await rm(directory, { recursive: true, force: true });
    }
    if (!AgentToolRunFiles.installations.has(this.files.root))
      await this.install(async () => undefined);
  }

  /** Serializes installations sharing a cache, including cleanup after every outcome. */
  public async install(operation: () => Promise<void>): Promise<void> {
    const previous = AgentToolRunFiles.installations.get(this.files.root);
    const work = (async () => {
      await previous;
      try {
        await operation();
      } finally {
        await this.clearCache();
      }
    })();
    const settled = work.catch(() => undefined);
    AgentToolRunFiles.installations.set(this.files.root, settled);
    try {
      await work;
    } finally {
      if (AgentToolRunFiles.installations.get(this.files.root) === settled)
        AgentToolRunFiles.installations.delete(this.files.root);
    }
  }

  /** Gives one run a private TMPDIR and removes it on success, failure or cancellation. */
  public async temporary<Result>(
    operation: (directory: string) => Promise<Result>,
  ): Promise<Result> {
    const directory = path.join(await this.temporaryRoot(), randomUUID());
    AgentToolRunFiles.temporaryDirectories.add(directory);
    try {
      await mkdir(directory, { mode: 0o700 });
      return await operation(directory);
    } finally {
      try {
        await rm(directory, { recursive: true, force: true });
      } finally {
        AgentToolRunFiles.temporaryDirectories.delete(directory);
      }
    }
  }

  private async temporaryRoot(): Promise<string> {
    await this.files.home();
    const directory = path.join(this.files.root, "probe", "tmp");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o022) !== 0
    )
      throw new Error("Unsafe probe temporary directory");
    return directory;
  }

  private async clearCache(): Promise<void> {
    await rm(path.join(this.files.root, "npm-cache"), {
      recursive: true,
      force: true,
    });
  }
}
