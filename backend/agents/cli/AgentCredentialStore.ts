import * as filesystem from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  boundAntigravityHome,
  requireBoundAntigravityHome,
} from "./AntigravityContextBinding";

import type { CliProviderId } from "@/definition/AgentConnection";
import type { AntigravityContextBinding } from "./AntigravityContextBinding";
import type { CliHome } from "./CliContracts";

/** The folder each CLI keeps its own configuration and login in. */
const CONFIG_DIRECTORIES: Readonly<Record<CliProviderId, string>> = {
  codex_cli: "codex",
  claude_code: "claude",
  opencode: "opencode",
  antigravity: "antigravity",
};

const UUID_PATTERN =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** Creates and removes isolated credential directories without reading credential files. */
export class AgentCredentialStore {
  private readonly root: string;
  private readonly files: typeof filesystem;
  private readonly binding: AntigravityContextBinding | null;

  public constructor(
    dataDirectory: string,
    files: typeof filesystem = filesystem,
    binding: AntigravityContextBinding | null = null,
  ) {
    this.root = path.resolve(dataDirectory, "agents");
    this.files = files;
    this.binding = binding;
  }

  /** The operator owns the bound context; Pages must not remove or log it out. */
  public isBound(id: string, provider: CliProviderId): boolean {
    return provider === "antigravity" && this.binding?.connectionId === id;
  }

  /** Resolves paths only; loaders can display a terminal command without creating anything. */
  public paths(id: string, provider: CliProviderId): CliHome {
    if (!UUID_PATTERN.test(id)) throw new AgentError("connection_not_found");
    if (this.binding && this.isBound(id, provider))
      return boundAntigravityHome(this.binding);
    const root = path.resolve(this.root, id);
    return {
      root,
      home: path.join(root, "home"),
      config: path.join(root, CONFIG_DIRECTORIES[provider]),
      work: path.join(root, "work"),
    };
  }

  /** Refuses symlinked directory roots and creates each directory with owner-only access. */
  public async prepare(id: string, provider: CliProviderId): Promise<CliHome> {
    const home = this.paths(id, provider);
    try {
      if (this.isBound(id, provider)) {
        await requireBoundAntigravityHome(home);
        return home;
      }
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
      await this.secureTree(home.root);
      return home;
    } catch (caughtError: unknown) {
      logCaughtError("AgentCredentialStore", caughtError);

      throw new AgentError("cli_not_executable");
    }
  }

  /**
   * Restores modes after CLI writes, without opening auth.json or any other file.
   *
   * @remarks
   * A symbolic link is never followed and never changed, wherever it points.
   * Tools of a session create links that leave the folder as a matter of
   * course, such as the registry of projects in the store of pnpm, which names
   * every workspace it ran in; refusing them would block the connection for
   * good, and leaving them alone exposes nothing, because no mode is set
   * through a link.
   */
  public async secure(id: string, provider: CliProviderId): Promise<void> {
    const home = this.paths(id, provider);
    try {
      if (this.isBound(id, provider)) {
        await requireBoundAntigravityHome(home);
        return;
      }
      await this.requireDirectory(this.root);
      await this.requireDirectory(home.root);
      await this.secureTree(home.root);
    } catch (caughtError: unknown) {
      logCaughtError("AgentCredentialStore", caughtError);

      throw new AgentError("cli_not_executable");
    }
  }

  /** A failed removal keeps the database record available for a later cleanup attempt. */
  public async remove(id: string, provider: CliProviderId): Promise<void> {
    if (this.isBound(id, provider)) return;
    const home = this.paths(id, provider);
    try {
      if (!(await this.exists(this.root))) return;
      await this.requireDirectory(this.root);
      if (!(await this.exists(home.root))) return;
      await this.requireDirectory(home.root);
      await this.files.rm(home.root, { recursive: true, force: true });
    } catch (caughtError: unknown) {
      logCaughtError("AgentCredentialStore", caughtError);

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
      logCaughtError("AgentCredentialStore", error);
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

  private async secureTree(directory: string): Promise<void> {
    for (const entry of await this.files.readdir(directory, {
      withFileTypes: true,
    })) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.files.chmod(target, 0o700);
        await this.secureTree(target);
      } else {
        await this.files.chmod(target, 0o600);
      }
    }
  }
}
