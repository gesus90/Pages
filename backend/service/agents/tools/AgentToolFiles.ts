import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { readStableVersion } from "@/definition/AgentToolVersion";
import { isAgentToolId } from "@/definition/AgentTools";

import {
  agentToolDefinition,
  agentToolPair,
  isOfficialArchiveUrl,
} from "./AgentToolRegistry";
import { AgentToolRunFiles } from "./AgentToolRunFiles";
import { AgentToolUpdateLock } from "./AgentToolUpdateLock";

import type { CliHome } from "@/backend/agents/cli/CliContracts";
import type {
  AgentToolId,
  AgentToolOperationView,
  AgentToolTerminalEntry,
} from "@/definition/AgentTools";
import type {
  AgentToolActivationEntry,
  AgentToolLocation,
  AgentToolLockKey,
  AgentToolPairLocations,
  AgentToolRelease,
  AgentToolReleaseFailure,
  AgentToolReleaseRecord,
  AgentToolStorage,
  AgentToolUpdateSearchSnapshot,
} from "./AgentToolContracts";
import type { AgentToolDefinition } from "./AgentToolRegistry";

const RELEASE_FAILURES: readonly AgentToolReleaseFailure[] = [
  "unreachable",
  "failed",
  "incompatible",
];

interface ReleasePointer {
  readonly current: string;
  readonly previous: string | null;
  readonly approvedTarget?: string | null;
}

/** One pointer change; `null` removes the tool's pointer. */
interface PointerChange {
  readonly tool: AgentToolDefinition;
  readonly pointer: ReleasePointer | null;
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function releaseVersion(name: string): string {
  return name.replace(
    /-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu,
    "",
  );
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isIsoTimestamp(input: unknown): input is string {
  return typeof input === "string" && Number.isFinite(Date.parse(input));
}

function isStableVersionText(input: unknown): input is string {
  return typeof input === "string" && readStableVersion(input) !== null;
}

function parseDependencies(input: unknown): Record<string, string> | null {
  if (!isPlainRecord(input)) return null;
  const dependencies: Record<string, string> = {};
  for (const [name, range] of Object.entries(input)) {
    if (typeof range !== "string") return null;
    dependencies[name] = range;
  }
  return dependencies;
}

// A kept release is installed later, so it may only name stable versions and
// an archive of the tool's own official source.
function parseRelease(
  tool: AgentToolDefinition,
  input: unknown,
): AgentToolRelease | null {
  if (!isPlainRecord(input)) return null;
  const { version, integrity, archiveUrl, cliVersion } = input;
  const dependencies = parseDependencies(input.dependencies);
  if (
    !isStableVersionText(version) ||
    (integrity !== null && typeof integrity !== "string") ||
    (archiveUrl !== null && typeof archiveUrl !== "string") ||
    (cliVersion !== undefined && !isStableVersionText(cliVersion)) ||
    dependencies === null ||
    !isOfficialArchiveUrl(tool, archiveUrl)
  )
    return null;
  return {
    version,
    integrity,
    archiveUrl,
    dependencies,
    ...(cliVersion === undefined ? {} : { cliVersion }),
  };
}

function parseReleaseFailure(
  input: unknown,
): AgentToolReleaseFailure | null | undefined {
  if (input === null) return null;
  return RELEASE_FAILURES.find((failure) => failure === input);
}

function parseReleaseRecord(
  tool: AgentToolDefinition,
  input: unknown,
): AgentToolReleaseRecord | null {
  if (!isPlainRecord(input) || !isIsoTimestamp(input.checkedAt)) return null;
  const failure = parseReleaseFailure(input.failure);
  if (failure === undefined) return null;
  const latest =
    input.latest === null ? null : parseRelease(tool, input.latest);
  const target =
    input.target === null ? null : parseRelease(tool, input.target);
  if ((input.latest !== null && !latest) || (input.target !== null && !target))
    return null;
  return { checkedAt: input.checkedAt, latest, target, failure };
}

// An entry that does not hold is left out, so the other tools keep their results.
function parseUpdateSearchSnapshot(
  input: unknown,
): AgentToolUpdateSearchSnapshot | null {
  if (!isPlainRecord(input) || input.version !== 1) return null;
  if (input.searchedAt !== null && !isIsoTimestamp(input.searchedAt))
    return null;
  if (!isPlainRecord(input.records)) return null;
  const records: Partial<Record<AgentToolId, AgentToolReleaseRecord>> = {};
  for (const [id, entry] of Object.entries(input.records)) {
    if (!isAgentToolId(id)) continue;
    const parsed = parseReleaseRecord(agentToolDefinition(id), entry);
    if (parsed !== null) records[id] = parsed;
  }
  return { version: 1, searchedAt: input.searchedAt, records };
}

/**
 * Owns only the instance's tools directory; no credential path is accepted.
 * @remarks
 * A CLI and its adapter share one pointer file, `pairs/<cli>.json`, which
 * names both generations. Publishing a combination replaces that file in
 * one rename, so a reader, a crash or an error between two steps sees the
 * old or the new checked combination, never one tool of each.
 */
export class AgentToolFiles implements AgentToolStorage {
  public readonly root: string;
  private readonly updateLock: AgentToolUpdateLock;

  public constructor(root: string) {
    this.root = path.resolve(root);
    this.updateLock = new AgentToolUpdateLock(this.root);
  }

  /** Clears leftovers before startup probes, preserving persistent probe directories. */
  public async initialize(): Promise<void> {
    await new AgentToolRunFiles(this).initialize();
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
    if (!pointer) return null;
    const location = this.location(tool, pointer.current);
    return {
      ...location,
      approvedTarget: pointer.approvedTarget ?? null,
      previousRelease: pointer.previous,
      ...(tool.hasTerminalEntry
        ? { terminalEntry: await this.readTerminalEntry(tool, location) }
        : {}),
    };
  }

  /** Every attempt gets a new generation, including a repair of the same version. */
  public async candidate(
    tool: AgentToolDefinition,
    version: string | null,
  ): Promise<AgentToolLocation> {
    const name = `${version ?? tool.version ?? "bundled"}-${randomUUID()}`;
    const location = this.location(tool, name);
    if (location.release) await this.directory(location.release);
    return location;
  }

  /** Publishes a verified generation in one rename and retains the previous release. */
  public async activate(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
  ): Promise<void> {
    await this.activateCombination([{ tool, location }]);
  }

  /** Publishes the generations of a CLI and its adapter together, in one rename of their pointer file. */
  public async activateCombination(
    entries: readonly AgentToolActivationEntry[],
  ): Promise<void> {
    const changes: PointerChange[] = [];
    for (const { tool, location } of entries) {
      if (
        !location.release ||
        path.dirname(location.release) !==
          path.join(this.root, tool.id, "releases")
      )
        throw new Error("Invalid managed release");
      const previous = await this.pointer(tool);
      const current = path.basename(location.release);
      const isSameVersion = previous
        ? releaseVersion(previous.current) === releaseVersion(current)
        : false;
      changes.push({
        tool,
        pointer: {
          current,
          previous:
            (isSameVersion ? previous?.previous : previous?.current) ?? null,
          approvedTarget: location.version ?? releaseVersion(current),
        },
      });
    }
    await this.writePointers(changes);
    for (const { tool, location } of entries)
      if (tool.hasTerminalEntry)
        await this.publishTerminalEntry(tool, location);
  }

  /** Reads both generations of a combination from one pointer read. */
  public async currentPair(
    cli: AgentToolDefinition,
  ): Promise<AgentToolPairLocations | null> {
    const pair = agentToolPair(cli);
    if (!pair) return null;
    const members = await this.readPair(pair.cli);
    const pointer = (
      tool: AgentToolDefinition,
    ): Promise<ReleasePointer | null> =>
      members
        ? Promise.resolve(members.get(tool.id) ?? null)
        : this.legacyPointer(tool);
    const cliPointer = await pointer(pair.cli);
    const adapterPointer = await pointer(pair.adapter);
    return {
      cli: cliPointer ? this.location(pair.cli, cliPointer.current) : null,
      adapter: adapterPointer
        ? this.location(pair.adapter, adapterPointer.current)
        : null,
    };
  }

  /** Takes the cross-process lock of a combination or the shared update search. */
  public lock(key: AgentToolLockKey): Promise<() => Promise<void>> {
    return this.updateLock.acquire(key);
  }

  /** Whether a live process holds the lock of a combination or the shared update search. */
  public isLocked(key: AgentToolLockKey): Promise<boolean> {
    return this.updateLock.isHeld(key);
  }

  /** Keeps the last operation state of a tool for a page reload or a restart. */
  public saveOperation(
    id: AgentToolId,
    operation: AgentToolOperationView,
  ): void {
    this.updateLock.saveOperation(id, operation);
  }

  /** Reads the kept operation states. */
  public readOperations(): Promise<
    ReadonlyMap<AgentToolId, AgentToolOperationView>
  > {
    return this.updateLock.readOperations();
  }

  /** Reads the kept result of the last update search, or `null` when it is missing or unreadable. */
  public async readUpdateSearch(): Promise<AgentToolUpdateSearchSnapshot | null> {
    try {
      const input = await this.readJson(
        path.join(this.root, "update-search.json"),
      );
      if (input === null) return null;
      const snapshot = parseUpdateSearchSnapshot(input);
      if (snapshot === null)
        console.warn("[pages] Kept agent tool update search state is invalid.");
      return snapshot;
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error ? error.code : null;
      console.warn(
        `[pages] Kept agent tool update search state cannot be read (${String(code ?? "invalid")}).`,
      );
      return null;
    }
  }

  /** Keeps the result of the last update search across restarts, replaced in one rename. */
  public async writeUpdateSearch(
    snapshot: AgentToolUpdateSearchSnapshot,
  ): Promise<void> {
    await this.writeJson(path.join(this.root, "update-search.json"), snapshot);
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

  /** Removes generations outside current/previous; the manager excludes installation and live users. */
  public async prune(tool: AgentToolDefinition): Promise<void> {
    let pointer = await this.pointer(tool);
    if (
      pointer?.previous &&
      releaseVersion(pointer.current) === releaseVersion(pointer.previous)
    ) {
      pointer = { ...pointer, previous: null };
      await this.writePointers([{ tool, pointer }]);
    }
    const kept = new Set([pointer?.current, pointer?.previous]);
    const releases = path.join(this.root, tool.id, "releases");
    const metadata = await lstat(releases).catch((error: unknown) => {
      if (missing(error)) return null;
      throw error;
    });
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) return;
    for (const entry of await readdir(releases, { withFileTypes: true })) {
      if (kept.has(entry.name)) continue;
      await rm(path.join(releases, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }

  /** Explicit removal never touches system packages or connection homes. */
  public async remove(tool: AgentToolDefinition): Promise<void> {
    const pair = agentToolPair(tool);
    if (pair && (await this.readPair(pair.cli)))
      await this.writePointers([{ tool, pointer: null }]);
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
    let file = path.join(release, "node_modules", ".bin", tool.binary);
    if (tool.kind === "browser") file = path.join(release, "browser");
    if (tool.release?.kind === "github") file = path.join(release, tool.binary);
    if (tool.kind === "runtime") file = path.join(release, "bin", tool.binary);
    const version = releaseVersion(name);
    return {
      file,
      source: "managed",
      release,
      version: version === name ? null : version,
    };
  }

  private terminalEntryFile(tool: AgentToolDefinition): string {
    return path.join(this.root, tool.id, "bin", tool.binary);
  }

  // The release pointer stays authoritative: a link that cannot follow it leaves the
  // published generation intact and is reported as not current instead of failing it.
  private async publishTerminalEntry(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
  ): Promise<void> {
    const entry = this.terminalEntryFile(tool);
    const temporary = `${entry}.${randomUUID()}.tmp`;
    try {
      await this.directory(path.dirname(entry));
      await symlink(
        path.relative(path.dirname(entry), location.file),
        temporary,
      );
      await rename(temporary, entry);
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error ? error.code : null;
      console.warn(
        `[pages] Terminal entry of agent tool ${tool.id} was not updated (${String(code ?? "unknown")}).`,
      );
      await rm(temporary, { force: true });
    }
  }

  private async readTerminalEntry(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
  ): Promise<AgentToolTerminalEntry> {
    const entry = this.terminalEntryFile(tool);
    try {
      const target = path.resolve(path.dirname(entry), await readlink(entry));
      return { path: entry, isCurrent: target === location.file };
    } catch (error: unknown) {
      if (!missing(error))
        console.warn(
          `[pages] Terminal entry of agent tool ${tool.id} is unreadable.`,
        );
      return { path: entry, isCurrent: false };
    }
  }

  // A tool of a combination reads the shared pointer file once it exists.
  private async pointer(
    tool: AgentToolDefinition,
  ): Promise<ReleasePointer | null> {
    const pair = agentToolPair(tool);
    const members = pair ? await this.readPair(pair.cli) : null;
    if (members) return members.get(tool.id) ?? null;
    return this.legacyPointer(tool);
  }

  private async legacyPointer(
    tool: AgentToolDefinition,
  ): Promise<ReleasePointer | null> {
    const input = await this.readJson(
      path.join(this.root, tool.id, "active.json"),
    );
    return input === null ? null : this.validPointer(tool, input);
  }

  private pairFile(cli: AgentToolDefinition): string {
    return path.join(this.root, "pairs", `${cli.id}.json`);
  }

  private async readPair(
    cli: AgentToolDefinition,
  ): Promise<Map<AgentToolId, ReleasePointer | null> | null> {
    const pair = agentToolPair(cli);
    const input = await this.readJson(this.pairFile(cli));
    if (input === null || !pair) return null;
    if (
      typeof input !== "object" ||
      !("members" in input) ||
      typeof input.members !== "object" ||
      input.members === null
    )
      throw new Error("Invalid combination pointer");
    const members = new Map<AgentToolId, ReleasePointer | null>();
    for (const tool of [pair.cli, pair.adapter]) {
      const member: unknown = Object.entries(input.members).find(
        ([id]) => id === tool.id,
      )?.[1];
      members.set(
        tool.id,
        member === undefined || member === null
          ? null
          : this.validPointer(tool, member),
      );
    }
    return members;
  }

  // Pointers of one combination change in one rename of their shared file.
  private async writePointers(
    changes: readonly PointerChange[],
  ): Promise<void> {
    const first = changes.at(0);
    const pair = first ? agentToolPair(first.tool) : null;
    if (!first || !pair) {
      for (const change of changes) await this.writeOwnPointer(change);
      return;
    }
    if (changes.some((change) => agentToolPair(change.tool)?.cli !== pair.cli))
      throw new Error("Pointer changes span several combinations");
    const members =
      (await this.readPair(pair.cli)) ??
      new Map<AgentToolId, ReleasePointer | null>([
        [pair.cli.id, await this.legacyPointer(pair.cli)],
        [pair.adapter.id, await this.legacyPointer(pair.adapter)],
      ]);
    for (const change of changes) members.set(change.tool.id, change.pointer);
    await this.writeJson(this.pairFile(pair.cli), {
      members: Object.fromEntries(members),
    });
  }

  private async writeOwnPointer(change: PointerChange): Promise<void> {
    const file = path.join(this.root, change.tool.id, "active.json");
    if (change.pointer === null) await rm(file, { force: true });
    else await this.writeJson(file, change.pointer);
  }

  private validPointer(
    tool: AgentToolDefinition,
    input: unknown,
  ): ReleasePointer {
    if (
      typeof input !== "object" ||
      input === null ||
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
