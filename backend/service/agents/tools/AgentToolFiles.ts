import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { isAgentToolId } from "@/definition/AgentTools";

import type { CliHome } from "@/backend/agents/cli/CliContracts";
import type { AgentToolId } from "@/definition/AgentTools";
import type { AgentToolLocation, AgentToolStorage } from "./AgentToolContracts";
import type { AgentToolDefinition } from "./AgentToolRegistry";

interface ReleasePointer {
  readonly current: string;
  readonly previous: string | null;
  readonly approvedTarget?: string | null;
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Owns only the instance's tools directory; no credential path is accepted. */
export class AgentToolFiles implements AgentToolStorage {
  public readonly root: string;

  public constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Creates a private home for probes and npm, separate from every login. */
  public async home(): Promise<CliHome> {
    const root = path.join(this.root, "probe");
    const home = {
      root,
      home: path.join(root, "home"),
      config: path.join(root, "config"),
      work: path.join(root, "work"),
    };
    for (const directory of Object.values(home))
      await this.directory(directory);
    return home;
  }

  /** Reads the atomically activated release without following arbitrary stored paths. */
  public async current(
    tool: AgentToolDefinition,
  ): Promise<AgentToolLocation | null> {
    const pointer = await this.pointer(tool);
    return pointer
      ? {
          ...this.location(tool, pointer.current),
          approvedTarget: pointer.approvedTarget ?? null,
        }
      : null;
  }

  /** Every attempt gets a new generation, including a repair of the same version. */
  public async candidate(
    tool: AgentToolDefinition,
  ): Promise<AgentToolLocation> {
    const name = `${tool.version ?? "bundled"}-${randomUUID()}`;
    const location = this.location(tool, name);
    if (location.release) await this.directory(location.release);
    return location;
  }

  /** Publishes a verified generation in one rename and retains the previous release. */
  public async activate(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
  ): Promise<void> {
    if (
      !location.release ||
      path.dirname(location.release) !==
        path.join(this.root, tool.id, "releases")
    )
      throw new Error("Invalid managed release");
    const previous = await this.pointer(tool);
    await this.writeJson(path.join(this.root, tool.id, "active.json"), {
      current: path.basename(location.release),
      previous: previous?.current ?? null,
      approvedTarget: tool.version,
    });
  }

  /** Resolves the retained generation without publishing it before its health check. */
  public async previous(
    tool: AgentToolDefinition,
  ): Promise<AgentToolLocation | null> {
    const pointer = await this.pointer(tool);
    return pointer?.previous ? this.location(tool, pointer.previous) : null;
  }

  /** Removes only an unpublished candidate created below this store. */
  public async discard(location: AgentToolLocation): Promise<void> {
    if (!location.release) throw new Error("Invalid managed release");
    const segments = path.relative(this.root, location.release).split(path.sep);
    if (
      segments.length !== 3 ||
      !isAgentToolId(segments[0]) ||
      segments[1] !== "releases" ||
      !/^[\w.-]+$/u.test(segments[2])
    )
      throw new Error("Invalid managed release");
    await rm(location.release, { recursive: true, force: true });
  }

  /** Explicit removal never touches system packages or connection homes. */
  public async remove(tool: AgentToolDefinition): Promise<void> {
    await rm(path.join(this.root, tool.id), { recursive: true, force: true });
  }

  /** Reads only the fixed IDs enabled by an administrator. */
  public async readEnabled(): Promise<readonly AgentToolId[]> {
    const input = await this.readJson(path.join(this.root, "enabled.json"));
    if (input === null) return [];
    if (!Array.isArray(input) || !input.every(isAgentToolId))
      throw new Error("Invalid tool settings");
    return input;
  }

  /** Replaces enabled integrations without modifying the instance's main configuration. */
  public async writeEnabled(ids: readonly AgentToolId[]): Promise<void> {
    await this.writeJson(path.join(this.root, "enabled.json"), [
      ...new Set(ids),
    ]);
  }

  private location(tool: AgentToolDefinition, name: string): AgentToolLocation {
    if (name === "." || name === ".." || !/^[\w.-]+$/u.test(name))
      throw new Error("Invalid release name");
    const release = path.join(this.root, tool.id, "releases", name);
    return {
      file:
        tool.kind === "browser"
          ? path.join(release, "browser")
          : path.join(release, "node_modules", ".bin", tool.binary),
      source: "managed",
      release,
      version:
        tool.versions.find((version) => name.startsWith(`${version}-`)) ?? null,
    };
  }

  private async pointer(
    tool: AgentToolDefinition,
  ): Promise<ReleasePointer | null> {
    const input = await this.readJson(
      path.join(this.root, tool.id, "active.json"),
    );
    if (input === null) return null;
    if (
      typeof input !== "object" ||
      !("current" in input) ||
      typeof input.current !== "string" ||
      !("previous" in input) ||
      (input.previous !== null && typeof input.previous !== "string")
    )
      throw new Error("Invalid release pointer");
    const approvedTarget =
      "approvedTarget" in input ? input.approvedTarget : null;
    if (approvedTarget !== null && typeof approvedTarget !== "string")
      throw new Error("Invalid approved target");
    this.location(tool, input.current);
    if (input.previous) this.location(tool, input.previous);
    return {
      current: input.current,
      previous: input.previous,
      approvedTarget,
    };
  }

  private async readJson(file: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch (error: unknown) {
      if (missing(error)) return null;
      throw error;
    }
  }

  private async writeJson(file: string, content: unknown): Promise<void> {
    await this.directory(path.dirname(file));
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(content)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async directory(directory: string): Promise<void> {
    const relative = path.relative(this.root, directory);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Tool path outside instance");
    let current = this.root;
    await this.safeDirectory(current);
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      await this.safeDirectory(current);
    }
  }

  private async safeDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o022) !== 0
    )
      throw Object.assign(new Error("Unsafe tool directory"), {
        code: "EPERM",
      });
    await access(directory, constants.W_OK | constants.X_OK);
  }
}
