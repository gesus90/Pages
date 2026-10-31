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

/** The staging context of a running login, inside the connection's own folder. */
const LOGIN_DIRECTORY = "login";

/** What the official Antigravity adapter writes for a personal sign-in, settings first. */
const ANTIGRAVITY_LOGIN_FILES = ["settings.json", "acp_token.json"] as const;

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

  /**
   * Where a login writes its account.
   *
   * @remarks
   * Antigravity signs in inside a separate staging context, so a failed,
   * cancelled or expired attempt never touches the connection's valid account.
   * Every other CLI keeps its own login flow in the connection context.
   */
  public loginPaths(id: string, provider: CliProviderId): CliHome {
    const home = this.paths(id, provider);
    if (provider !== "antigravity" || this.isBound(id, provider)) return home;
    const root = path.join(home.root, LOGIN_DIRECTORY);
    return {
      root,
      home: path.join(root, "home"),
      config: path.join(root, CONFIG_DIRECTORIES[provider]),
      work: path.join(root, "work"),
    };
  }

  /**
   * Prepares the connection context and a fresh, empty login context.
   *
   * @param id - The connection.
   * @param provider - Its CLI.
   * @returns The context the login writes to, see {@link loginPaths}.
   */
  public async prepareLogin(
    id: string,
    provider: CliProviderId,
  ): Promise<CliHome> {
    const home = await this.prepare(id, provider);
    const login = this.loginPaths(id, provider);
    if (login.root === home.root) return home;
    try {
      // A staging context left by an interrupted server never carries over.
      await this.removeDirectory(login.root);
      for (const directory of [
        login.root,
        login.home,
        login.config,
        login.work,
        ...["config", "cache", "data", "state"].map((name) =>
          path.join(login.home, name),
        ),
      ]) {
        await this.ensureDirectory(directory);
      }
      return login;
    } catch (caughtError: unknown) {
      logCaughtError("AgentCredentialStore", caughtError);

      throw new AgentError("cli_not_executable");
    }
  }

  /**
   * Moves a confirmed sign-in from the login context into the connection.
   *
   * @param id - The connection.
   * @param provider - Its CLI; a no-op for logins in the connection context.
   * @throws {AgentError} `cli_not_logged_in` when the login stored no token.
   *
   * @remarks
   * Each file is renamed within the connection folder, which replaces the
   * previous one atomically. No file is opened or read.
   */
  public async adoptLogin(id: string, provider: CliProviderId): Promise<void> {
    const home = this.paths(id, provider);
    const login = this.loginPaths(id, provider);
    if (login.root === home.root) return;
    const source = path.join(login.config, "antigravity-acp");
    const target = path.join(home.config, "antigravity-acp");
    try {
      const present = await this.readLoginFiles(source);
      if (!present.includes("acp_token.json"))
        throw new AgentError("cli_not_logged_in");
      await this.ensureDirectory(home.config);
      await this.ensureDirectory(target);
      for (const name of present)
        await this.files.rename(
          path.join(source, name),
          path.join(target, name),
        );
    } catch (caughtError: unknown) {
      logCaughtError("AgentCredentialStore", caughtError);

      throw caughtError instanceof AgentError
        ? caughtError
        : new AgentError("cli_not_executable");
    }
  }

  /** Removes the login context; the connection's own account stays as it is. */
  public async discardLogin(
    id: string,
    provider: CliProviderId,
  ): Promise<void> {
    const login = this.loginPaths(id, provider);
    if (login.root === this.paths(id, provider).root) return;
    try {
      await this.removeDirectory(login.root);
    } catch (caughtError: unknown) {
      logCaughtError("AgentCredentialStore", caughtError);

      throw new AgentError("credential_cleanup_failed");
    }
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

  private async readLoginFiles(directory: string): Promise<string[]> {
    const present: string[] = [];
    for (const name of ANTIGRAVITY_LOGIN_FILES) {
      const file = path.join(directory, name);
      if (!(await this.exists(file))) continue;
      if (!(await this.files.lstat(file)).isFile())
        throw new AgentError("antigravity_configuration_unmanaged");
      present.push(name);
    }
    return present;
  }

  private async removeDirectory(directory: string): Promise<void> {
    if (!(await this.exists(directory))) return;
    await this.requireDirectory(directory);
    await this.files.rm(directory, { recursive: true, force: true });
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
