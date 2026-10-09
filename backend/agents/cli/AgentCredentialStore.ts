import * as filesystem from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

import type { CliProviderId } from "@/definition/AgentConnection";
import type { CliHome } from "./CliContracts";

const UUID_PATTERN =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

// Codex links its helper commands (apply_patch, codex-linux-sandbox, ...) to its own
// binary below CODEX_HOME/tmp/arg0 and does not remove them on every exit.
function isCodexHelperLink(
  link: string,
  destination: string,
  root: string,
): boolean {
  return (
    link.startsWith(path.join(root, "codex", "tmp", "arg0") + path.sep) &&
    path.basename(destination) === "codex"
  );
}

/** Creates and removes isolated credential directories without reading credential files. */
export class AgentCredentialStore {
  private readonly root: string;
  private readonly files: typeof filesystem;

  public constructor(
    dataDirectory: string,
    files: typeof filesystem = filesystem,
  ) {
    this.root = path.resolve(dataDirectory, "agents");
    this.files = files;
  }

  /** Resolves paths only; loaders can display a terminal command without creating anything. */
  public paths(id: string, provider: CliProviderId): CliHome {
    if (!UUID_PATTERN.test(id)) throw new AgentError("connection_not_found");
    const root = path.resolve(this.root, id);
    return {
      root,
      home: path.join(root, "home"),
      config: path.join(root, provider === "codex_cli" ? "codex" : "claude"),
      work: path.join(root, "work"),
    };
  }

  /** Refuses symlinked directory roots and creates each directory with owner-only access. */
  public async prepare(id: string, provider: CliProviderId): Promise<CliHome> {
    const home = this.paths(id, provider);
    try {
      for (const directory of [
        this.root,
        home.root,
        home.home,
        home.config,
        home.work,
        ...["config", "cache", "data", "state"].map((name) =>
          path.join(home.home, name),
        ),
      ]) {
        await this.ensureDirectory(directory);
      }
      await this.secureTree(home.root, home.root);
      return home;
    } catch {
      throw new AgentError("cli_not_executable");
    }
  }

  /** Restores modes after CLI writes, without opening auth.json or any other file. */
  public async secure(id: string, provider: CliProviderId): Promise<void> {
    const home = this.paths(id, provider);
    try {
      await this.requireDirectory(this.root);
      await this.requireDirectory(home.root);
      await this.secureTree(home.root, home.root);
    } catch {
      throw new AgentError("cli_not_executable");
    }
  }

  /** A failed removal keeps the database record available for a later cleanup attempt. */
  public async remove(id: string, provider: CliProviderId): Promise<void> {
    const home = this.paths(id, provider);
    try {
      if (!(await this.exists(this.root))) return;
      await this.requireDirectory(this.root);
      if (!(await this.exists(home.root))) return;
      await this.requireDirectory(home.root);
      await this.files.rm(home.root, { recursive: true, force: true });
    } catch {
      throw new AgentError("credential_cleanup_failed");
    }
  }

  private async exists(directory: string): Promise<boolean> {
    try {
      await this.files.lstat(directory);
      return true;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return false;
      throw error;
    }
  }

  private async requireDirectory(directory: string): Promise<void> {
    if (!(await this.files.lstat(directory)).isDirectory())
      throw new AgentError("cli_not_executable");
  }

  private async ensureDirectory(directory: string): Promise<void> {
    if (!(await this.exists(directory)))
      await this.files.mkdir(directory, { mode: 0o700 });
    await this.requireDirectory(directory);
    await this.files.chmod(directory, 0o700);
  }

  private async secureTree(directory: string, root: string): Promise<void> {
    for (const entry of await this.files.readdir(directory, {
      withFileTypes: true,
    })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const destination = path.resolve(
          directory,
          await this.files.readlink(target),
        );
        if (
          !destination.startsWith(root + path.sep) &&
          !isCodexHelperLink(target, destination, root)
        )
          throw new AgentError("cli_not_executable");
      } else if (entry.isDirectory()) {
        await this.files.chmod(target, 0o700);
        await this.secureTree(target, root);
      } else {
        await this.files.chmod(target, 0o600);
      }
    }
  }
}
