import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

/** Server-owned allowlist; an empty list disables registration and resolution. */
export interface AgentWorkspacePathOptions {
  readonly roots: readonly string[];
  readonly protectedDirectory: string;
}

/** Uses path segments rather than string prefixes, including for symlink destinations. */
export function containsWorkspacePath(
  root: string,
  directory: string,
): boolean {
  const relative = path.relative(root, directory);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/** Network share notation such as `//host/share` names a location away from this machine. */
function isNetworkLocation(input: string): boolean {
  return /^[\\/]{2}/u.test(input);
}

/** Accepts local absolute paths only; URLs, `host:path` notation and shares are not local. */
function requireAbsoluteDirectory(input: string): void {
  if (
    !path.isAbsolute(input) ||
    isNetworkLocation(input) ||
    input.length > 4096 ||
    /[\u0000-\u001f\u007f]/u.test(input) ||
    input.split(/[\\/]/u).includes("..") ||
    path.resolve(input) === path.parse(input).root
  )
    throw new AgentError("workspace_path_invalid");
}

/** Checks existing directories without creating files, changing modes or running Git. */
export class AgentWorkspacePath {
  private readonly options: AgentWorkspacePathOptions;

  public constructor(options: AgentWorkspacePathOptions) {
    this.options = options;
  }

  /** Reports configuration availability without exposing server roots to users. */
  public isConfigured(): boolean {
    return this.options.roots.length > 0;
  }

  /** Canonicalizes within approved roots and requires service-user read/write/traverse access. */
  public async inspect(
    input: string,
  ): Promise<{ readonly path: string; readonly identity: string }> {
    requireAbsoluteDirectory(input);
    if (!this.isConfigured()) throw new AgentError("workspace_roots_missing");
    try {
      const directory = await realpath(input);
      requireAbsoluteDirectory(directory);
      const roots = await this.canonicalRoots();
      if (!roots.some((root) => containsWorkspacePath(root, directory)))
        throw new AgentError("workspace_path_outside_roots");
      const protectedDirectory = await realpath(
        this.options.protectedDirectory,
      );
      if (
        containsWorkspacePath(protectedDirectory, directory) ||
        containsWorkspacePath(directory, protectedDirectory)
      )
        throw new AgentError("workspace_path_outside_roots");
      const metadata = await stat(directory, { bigint: true });
      if (!metadata.isDirectory())
        throw new AgentError("workspace_path_invalid");
      await access(directory, constants.R_OK | constants.W_OK | constants.X_OK);
      return { path: directory, identity: `${metadata.dev}:${metadata.ino}` };
    } catch (error: unknown) {
      if (error instanceof AgentError) throw error;
      throw new AgentError("workspace_path_unavailable");
    }
  }

  /** Refuses renamed, replaced or redirected registrations instead of silently rebinding. */
  public async resolve(workspace: {
    readonly path: string;
    readonly directoryIdentity: string;
  }): Promise<string> {
    const inspected = await this.inspect(workspace.path);
    if (
      inspected.path !== workspace.path ||
      inspected.identity !== workspace.directoryIdentity
    )
      throw new AgentError("workspace_path_changed");
    return inspected.path;
  }

  private async canonicalRoots(): Promise<readonly string[]> {
    const roots: string[] = [];
    for (const configured of this.options.roots) {
      requireAbsoluteDirectory(configured);
      const root = await realpath(configured);
      requireAbsoluteDirectory(root);
      if (!(await stat(root)).isDirectory())
        throw new AgentError("workspace_path_invalid");
      roots.push(root);
    }
    return roots;
  }
}
