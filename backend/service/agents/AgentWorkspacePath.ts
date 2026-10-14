import { constants } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

import type { Dirent } from "node:fs";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  WorkspaceFolderEntry,
  WorkspaceFolderListing,
  WorkspaceFolderRequest,
} from "@/definition/AgentWorkspace";

/** Server-owned allowlist; an empty list disables registration and resolution. */
export interface AgentWorkspacePathOptions {
  readonly roots: readonly string[];
  readonly protectedDirectory: string;
  /** Further instance folders a working copy may neither contain nor lie within. */
  readonly additionalProtectedDirectories?: readonly string[];
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

/** A level with more directories than this is cut after sorting and says so. */
const MAXIMUM_LISTED_FOLDERS = 500;

/** What decides whether a directory below the current level is offered. */
interface FolderListingContext {
  readonly roots: readonly string[];
  readonly protectedDirectories: readonly string[];
  readonly showHidden: boolean;
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

function isPermissionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EACCES" || error.code === "EPERM")
  );
}

/** The location a listed entry leads to, or `null` when it is not a directory. */
async function folderTarget(
  directory: string,
  entry: Dirent,
): Promise<string | null> {
  const child = path.join(directory, entry.name);
  // The listed level is canonical, so a real child directory is as well.
  if (entry.isDirectory()) return child;
  if (!entry.isSymbolicLink()) return null;
  try {
    const target = await realpath(child);
    return (await stat(target)).isDirectory() ? target : null;
  } catch {
    // A broken or unreadable link is not offered; it does not fail the level.
    return null;
  }
}

/** Offers a directory only where registration could accept it or a path below it. */
async function offeredFolder(
  directory: string,
  entry: Dirent,
  context: FolderListingContext,
): Promise<WorkspaceFolderEntry | null> {
  if (!context.showHidden && entry.name.startsWith(".")) return null;
  const target = await folderTarget(directory, entry);
  if (target === null) return null;
  const isWithinRoots = context.roots.some((root) =>
    containsWorkspacePath(root, target),
  );
  const isProtected = context.protectedDirectories.some((entryPath) =>
    containsWorkspacePath(entryPath, target),
  );
  if (!isWithinRoots || isProtected) return null;
  return { name: entry.name, path: path.join(directory, entry.name) };
}

function rootsLevel(roots: readonly string[]): WorkspaceFolderListing {
  return {
    path: null,
    breadcrumbs: [],
    hasSeveralRoots: true,
    folders: roots.map((root) => ({ name: root, path: root })),
    isTruncated: false,
    selectionIssue: null,
  };
}

function compareFolderNames(
  left: WorkspaceFolderEntry,
  right: WorkspaceFolderEntry,
): number {
  return left.name.localeCompare(right.name, "en", { numeric: true });
}

/** The root that holds the directory, followed by every step down to it. */
function breadcrumbsOf(
  directory: string,
  roots: readonly string[],
): WorkspaceFolderEntry[] {
  const [root] = roots
    .filter((candidate) => containsWorkspacePath(candidate, directory))
    .sort((left, right) => right.length - left.length);
  if (root === undefined) return [];
  const breadcrumbs = [{ name: root, path: root }];
  let current = root;
  for (const segment of path.relative(root, directory).split(path.sep)) {
    if (segment === "") continue;
    current = path.join(current, segment);
    breadcrumbs.push({ name: segment, path: current });
  }
  return breadcrumbs;
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
      const directory = await this.canonicalDirectory(input, roots);
      if (!roots.some((root) => containsWorkspacePath(root, directory)))
        throw new AgentError("workspace_path_outside_roots");
      requireAbsoluteDirectory(directory);
      await this.requireOutsideProtected(directory);
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

  /**
   * Lists the directories of one level below an approved root.
   *
   * @remarks
   * Only directories are listed, and only those a workspace could live in or
   * below: links that leave the roots and the Pages instance folders are left
   * out, so nothing above the roots and no file name is disclosed. A level is
   * opened under the rules of a typed path; whether it can be registered as
   * well is reported separately, because a level may only lead on.
   *
   * @param request - Directory to list; `null` starts at the approved roots.
   */
  public async browse(
    request: WorkspaceFolderRequest,
  ): Promise<WorkspaceFolderListing> {
    if (!this.isConfigured()) throw new AgentError("workspace_roots_missing");
    try {
      const roots = [...new Set(await this.canonicalRoots())];
      const requested = request.path?.trim() ?? "";
      if (requested === "" && roots.length > 1) return rootsLevel(roots);
      const protectedDirectories = await this.canonicalProtectedDirectories();
      const directory = await this.browsableDirectory(
        requested,
        roots,
        protectedDirectories,
      );
      const folders = await this.listFolders(directory, {
        roots,
        protectedDirectories,
        showHidden: request.showHidden,
      });
      return {
        path: directory,
        breadcrumbs: breadcrumbsOf(directory, roots),
        hasSeveralRoots: roots.length > 1,
        folders: folders.slice(0, MAXIMUM_LISTED_FOLDERS),
        isTruncated: folders.length > MAXIMUM_LISTED_FOLDERS,
        selectionIssue: await this.selectionIssue(
          directory,
          protectedDirectories,
        ),
      };
    } catch (error: unknown) {
      if (error instanceof AgentError) throw error;
      throw new AgentError(
        isPermissionError(error)
          ? "workspace_path_denied"
          : "workspace_path_unavailable",
      );
    }
  }

  /**
   * Refuses a directory that contains or lies within an instance folder.
   *
   * @remarks
   * The data directory must exist. A further folder, such as the agent
   * directory, is created on first use, so a missing one is compared by its
   * typed path.
   */
  private async requireOutsideProtected(directory: string): Promise<void> {
    const protectedDirectories = await this.canonicalProtectedDirectories();
    if (
      protectedDirectories.some(
        (entry) =>
          containsWorkspacePath(entry, directory) ||
          containsWorkspacePath(directory, entry),
      )
    )
      throw new AgentError("workspace_path_outside_roots");
  }

  private async canonicalProtectedDirectories(): Promise<readonly string[]> {
    return [
      await realpath(this.options.protectedDirectory),
      ...(await Promise.all(
        (this.options.additionalProtectedDirectories ?? []).map((entry) =>
          realpath(entry).catch(() => path.resolve(entry)),
        ),
      )),
    ];
  }

  /**
   * Resolves the level to list and requires that it can be opened.
   *
   * @remarks
   * Unlike a registration, a level may contain an instance folder, because
   * the way to a permitted directory can lead through it; only a level inside
   * one is refused.
   */
  private async browsableDirectory(
    requested: string,
    roots: readonly string[],
    protectedDirectories: readonly string[],
  ): Promise<string> {
    let directory = roots[0];
    if (requested !== "") {
      requireAbsoluteDirectory(requested);
      if (isNetworkLocation(requested))
        throw new AgentError("workspace_path_invalid");
      directory = await this.canonicalDirectory(requested, roots);
    }
    if (!roots.some((root) => containsWorkspacePath(root, directory)))
      throw new AgentError("workspace_path_outside_roots");
    requireAbsoluteDirectory(directory);
    if (
      protectedDirectories.some((entry) =>
        containsWorkspacePath(entry, directory),
      )
    )
      throw new AgentError("workspace_path_outside_roots");
    if (!(await stat(directory)).isDirectory())
      throw new AgentError("workspace_path_invalid");
    await access(directory, constants.R_OK | constants.X_OK);
    return directory;
  }

  private async listFolders(
    directory: string,
    context: FolderListingContext,
  ): Promise<WorkspaceFolderEntry[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const offered = await Promise.all(
      entries.map((entry) => offeredFolder(directory, entry, context)),
    );
    return offered
      .filter((folder): folder is WorkspaceFolderEntry => folder !== null)
      .sort(compareFolderNames);
  }

  /**
   * Reports why registration would refuse this very level.
   *
   * @remarks
   * A level above an instance folder is only the way to a permitted
   * directory, so it is named as such instead of as an outside location.
   */
  private async selectionIssue(
    directory: string,
    protectedDirectories: readonly string[],
  ): Promise<AgentErrorCode | null> {
    try {
      await this.inspect(directory);
      return null;
    } catch (error: unknown) {
      if (!(error instanceof AgentError)) throw error;
      const holdsInstanceData = protectedDirectories.some((entry) =>
        containsWorkspacePath(directory, entry),
      );
      if (error.code === "workspace_path_outside_roots" && holdsInstanceData)
        return "workspace_path_contains_instance";
      return error.code;
    }
  }

  /**
   * Resolves symlinks of a typed path.
   *
   * @remarks
   * A typed path that cannot be resolved and lies outside every root reports
   * the same refusal as an existing one outside them, so the answer does not
   * tell whether a path beyond the approved roots exists.
   */
  private async canonicalDirectory(
    input: string,
    canonicalRoots: readonly string[],
  ): Promise<string> {
    try {
      return await realpath(input);
    } catch {
      const typed = path.resolve(input);
      const isWithin = [
        ...canonicalRoots,
        ...this.options.roots.map((root) => path.resolve(root)),
      ].some((root) => containsWorkspacePath(root, typed));
      throw new AgentError(
        isWithin
          ? "workspace_path_unavailable"
          : "workspace_path_outside_roots",
      );
    }
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
