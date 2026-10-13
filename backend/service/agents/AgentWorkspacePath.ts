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

function requireAbsoluteDirectory(input: string): void {
  if (
    !path.isAbsolute(input) ||
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

  /**
   * Canonicalizes within approved roots and requires service-user read/write/traverse access.
   *
   * @remarks
   * A typed path must be local: URLs, `host:path` notation and network shares
   * are refused. The approved roots are the operator's decision and are not
   * judged by their notation.
   */
  public async inspect(
    input: string,
  ): Promise<{ readonly path: string; readonly identity: string }> {
    requireAbsoluteDirectory(input);
    if (isNetworkLocation(input))
      throw new AgentError("workspace_path_invalid");
    if (!this.isConfigured()) throw new AgentError("workspace_roots_missing");
    try {
      const roots = await this.canonicalRoots();
      // A path outside the roots is refused before the filesystem is asked about it,
      // so the answer does not tell whether it exists.
      if (!this.isLexicallyWithin(input, roots))
        throw new AgentError("workspace_path_outside_roots");
      const directory = await realpath(input);
      requireAbsoluteDirectory(directory);
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

  private isLexicallyWithin(
    input: string,
    canonicalRoots: readonly string[],
  ): boolean {
    const typed = path.resolve(input);
    return [
      ...canonicalRoots,
      ...this.options.roots.map((root) => path.resolve(root)),
    ].some((root) => containsWorkspacePath(root, typed));
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
