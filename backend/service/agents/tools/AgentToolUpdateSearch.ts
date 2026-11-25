import {
  compareStableVersions,
  readStableVersion,
  satisfiesVersionRange,
} from "@/definition/AgentToolVersion";
import { isAgentToolId } from "@/definition/AgentTools";

import { AgentToolReadinessError } from "./AgentToolReadinessError";
import { AGENT_TOOL_REGISTRY, agentToolDefinition } from "./AgentToolRegistry";
import {
  ReleaseIncompatibleError,
  ReleaseSourceUnreachableError,
} from "./AgentToolRuntimeReleases";

import type {
  AgentToolId,
  AgentToolReleaseView,
  AgentToolUpdateState,
} from "@/definition/AgentTools";
import type {
  AgentToolRelease,
  AgentToolReleaseFailure,
  AgentToolReleaseRecord,
  AgentToolStorage,
  AgentToolUpdateSearchSnapshot,
} from "./AgentToolContracts";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type {
  AgentToolReleaseCheck,
  AgentToolReleaseOutcome,
} from "./AgentToolReleaseCheck";

/** The generation new sessions use, as the update state compares it. */
export interface AgentToolActiveRelease {
  /** `null` while the tool has not been checked yet; `false` when a check found none. */
  readonly installed: boolean | null;
  readonly version: string | null;
  readonly source: "managed" | "system" | "bundled" | null;
}

/** Optional persistence, cross-process locking and clock injection for update searches. */
export interface AgentToolUpdateSearchOptions {
  readonly storage?: Pick<
    AgentToolStorage,
    "readUpdateSearch" | "writeUpdateSearch" | "lock" | "isLocked"
  >;
  /** Epoch clock in milliseconds; tests pass a controlled clock. */
  readonly now?: () => number;
}

const FAILURE_STATES: Readonly<
  Record<AgentToolReleaseFailure, AgentToolUpdateState>
> = {
  unreachable: "source_unreachable",
  failed: "check_failed",
  incompatible: "incompatible",
};

function sourceLabel(tool: AgentToolDefinition): string | null {
  const source = tool.release;
  if (!source) return null;
  switch (source.kind) {
    case "npm":
      return `registry.npmjs.org/${source.packageName}`;
    case "node":
      return `nodejs.org/dist (v${source.major}.x)`;
    case "python":
      return `github.com/${source.repository}/releases (${source.line}.x)`;
    case "github":
      return `github.com/${source.repository}/releases`;
  }
}

function outcomeRecord(
  outcome: AgentToolReleaseOutcome,
  checkedAt: string,
): AgentToolReleaseRecord {
  return outcome.ok
    ? {
        checkedAt,
        latest: outcome.release,
        target: outcome.release,
        failure: null,
      }
    : { checkedAt, latest: null, target: null, failure: outcome.failure };
}

function unexpectedFailure(error: unknown): AgentToolReleaseFailure {
  if (error instanceof ReleaseSourceUnreachableError) return "unreachable";
  if (error instanceof ReleaseIncompatibleError) return "incompatible";
  return "failed";
}

function isNewerTimestamp(
  candidate: string | null,
  current: string | null,
): boolean {
  if (candidate === null) return false;
  if (current === null) return true;
  return Date.parse(candidate) > Date.parse(current);
}

/**
 * Reads release metadata from fixed official sources, persists results across restarts and serializes concurrent searches.
 * @remarks
 * Searching never installs or activates anything; it only determines compatible
 * targets. While a tool's installed version is unknown or confirmed missing,
 * no update is reported as available.
 */
export class AgentToolUpdateSearch {
  private readonly releases: AgentToolReleaseCheck;
  private readonly storage: AgentToolUpdateSearchOptions["storage"];
  private readonly now: () => number;
  private readonly records = new Map<AgentToolId, AgentToolReleaseRecord>();
  private running: Promise<boolean> | null = null;
  private restored: Promise<void> | null = null;
  private lastSearchedAt: string | null = null;

  public constructor(
    releases: AgentToolReleaseCheck,
    options: AgentToolUpdateSearchOptions = {},
  ) {
    this.releases = releases;
    this.storage = options.storage;
    this.now = options.now ?? ((): number => Date.now());
  }

  /** Loads the last persisted search timestamp and per-tool results once. */
  public restore(): Promise<void> {
    this.restored ??= this.loadPersisted();
    return this.restored;
  }

  /** ISO timestamp of the last completed server-wide update search, or `null` before the first one. */
  public searchedAt(): string | null {
    return this.lastSearchedAt;
  }

  /**
   * Whether at least `intervalMs` elapsed since the last completed update search.
   * @remarks
   * A time in the future, as a set-back clock leaves it, counts as elapsed,
   * so the search does not stay away until that time is reached.
   */
  public isDue(intervalMs: number): boolean {
    if (this.lastSearchedAt === null) return true;
    const elapsed = this.now() - Date.parse(this.lastSearchedAt);
    return !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= intervalMs;
  }

  /**
   * Reads every fixed source once; a second request joins a running search.
   * @param signal - Cancels the search on shutdown.
   */
  public async search(signal: AbortSignal): Promise<void> {
    await this.restore();
    const active = this.running;
    if (active) {
      const didSearch = await active;
      if (didSearch || signal.aborted) return;
    }
    await this.startSearch(signal, null);
  }

  /**
   * Runs one server-wide update search when the interval elapsed; skips when already fresh or another search runs.
   * @param signal - Cancels the search on shutdown.
   * @param intervalMs - Minimum milliseconds between automatic searches.
   * @returns `true` when this call performed a fresh search.
   */
  public async searchIfDue(
    signal: AbortSignal,
    intervalMs: number,
  ): Promise<boolean> {
    await this.restore();
    if (this.running) {
      await this.running;
      return false;
    }
    if (!this.isDue(intervalMs)) return false;
    return this.startSearch(signal, intervalMs);
  }

  /** The release the last search chose for an update, if it found one. */
  public target(id: AgentToolId): AgentToolRelease | null {
    return this.records.get(id)?.target ?? null;
  }

  /** Whether an update search result exists for this tool (from this start or a persisted search). */
  public hasSearched(id: AgentToolId): boolean {
    return this.records.has(id);
  }

  /**
   * Resolves one exact release for an installation or repair.
   * @returns The release with its integrity proof, or `null` when the source does not confirm it.
   */
  public async exact(
    tool: AgentToolDefinition,
    version: string,
    signal: AbortSignal,
  ): Promise<AgentToolRelease | null> {
    const outcome = await this.releases.resolve(tool, version, signal);
    return outcome.ok ? outcome.release : null;
  }

  /** The update state of a tool against the generation new sessions use. */
  public view(
    tool: AgentToolDefinition,
    active: AgentToolActiveRelease,
  ): AgentToolReleaseView {
    const record = this.records.get(tool.id);
    return {
      state: record ? this.state(record, active) : "not_checked",
      latestVersion: record?.latest?.version ?? null,
      targetVersion: record?.target?.version ?? null,
      source: sourceLabel(tool),
      checkedAt: record?.checkedAt ?? null,
    };
  }

  private state(
    record: AgentToolReleaseRecord,
    active: AgentToolActiveRelease,
  ): AgentToolUpdateState {
    if (record.failure) return FAILURE_STATES[record.failure];
    const target = record.target
      ? readStableVersion(record.target.version)
      : null;
    if (!target) return "check_failed";
    if (active.source === "system") return "external";
    if (active.installed === false) return "not_installed";
    const current = active.version ? readStableVersion(active.version) : null;
    if (active.installed === null || !current) return "version_unknown";
    return compareStableVersions(target, current) > 0
      ? "update_available"
      : "current";
  }

  private startSearch(
    signal: AbortSignal,
    dueIntervalMs: number | null,
  ): Promise<boolean> {
    if (this.running) return this.running.then(() => false);
    const work = this.executeSearch(signal, dueIntervalMs).finally(() => {
      if (this.running === work) this.running = null;
    });
    this.running = work;
    return work;
  }

  private async executeSearch(
    signal: AbortSignal,
    dueIntervalMs: number | null,
  ): Promise<boolean> {
    const release = await this.acquireLock(dueIntervalMs !== null);
    if (release === "busy") return false;
    try {
      if (await this.isSatisfiedFromStorage(dueIntervalMs)) return false;
      await this.run(signal);
      if (signal.aborted) return false;
      this.lastSearchedAt = new Date(this.now()).toISOString();
      await this.persistSnapshot();
      return true;
    } finally {
      await release?.();
    }
  }

  private async acquireLock(
    isAutomatic: boolean,
  ): Promise<(() => Promise<void>) | undefined | "busy"> {
    if (!this.storage?.lock) return undefined;
    try {
      return await this.storage.lock("update_search");
    } catch (error: unknown) {
      if (
        isAutomatic &&
        error instanceof AgentToolReadinessError &&
        error.diagnostic === "update_running"
      )
        return "busy";
      throw error;
    }
  }

  private async isSatisfiedFromStorage(
    dueIntervalMs: number | null,
  ): Promise<boolean> {
    if (dueIntervalMs === null || !this.storage?.readUpdateSearch) return false;
    const snapshot = await this.storage.readUpdateSearch();
    if (snapshot) this.applySnapshot(snapshot, true);
    return !this.isDue(dueIntervalMs);
  }

  private async loadPersisted(): Promise<void> {
    if (!this.storage?.readUpdateSearch) return;
    const snapshot = await this.storage.readUpdateSearch();
    if (snapshot) this.applySnapshot(snapshot, false);
  }

  private applySnapshot(
    snapshot: AgentToolUpdateSearchSnapshot,
    preferNewer: boolean,
  ): void {
    if (
      preferNewer &&
      !isNewerTimestamp(snapshot.searchedAt, this.lastSearchedAt)
    )
      return;
    if (this.lastSearchedAt === null || preferNewer)
      this.lastSearchedAt = snapshot.searchedAt;
    for (const [id, record] of Object.entries(snapshot.records)) {
      if (!isAgentToolId(id) || !record) continue;
      if (preferNewer || !this.records.has(id)) this.records.set(id, record);
    }
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.storage?.writeUpdateSearch) return;
    const records: Partial<Record<AgentToolId, AgentToolReleaseRecord>> = {};
    for (const [id, record] of this.records) records[id] = record;
    try {
      await this.storage.writeUpdateSearch({
        version: 1,
        searchedAt: this.lastSearchedAt,
        records,
      });
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error ? error.code : null;
      console.warn(
        `[pages] Agent tool update search state was not kept (${String(code ?? "unknown")}).`,
      );
    }
  }

  private async run(signal: AbortSignal): Promise<void> {
    for (const tool of AGENT_TOOL_REGISTRY) {
      if (signal.aborted) return;
      if (!tool.release || this.isAdapter(tool)) continue;
      const adapter = tool.adapter ? agentToolDefinition(tool.adapter) : null;
      await this.searchPair(tool, adapter, signal);
    }
  }

  private isAdapter(tool: AgentToolDefinition): boolean {
    return AGENT_TOOL_REGISTRY.some((entry) => entry.adapter === tool.id);
  }

  // One source error must never stop or obscure the release checks of the remaining tools.
  private async safeOutcome(
    work: () => Promise<AgentToolReleaseOutcome>,
    signal: AbortSignal,
  ): Promise<AgentToolReleaseOutcome> {
    try {
      return await work();
    } catch (error: unknown) {
      if (signal.aborted) return { ok: false, failure: "unreachable" };
      return { ok: false, failure: unexpectedFailure(error) };
    }
  }

  // The adapter's declared CLI range decides which CLI release the pair moves to,
  // unless the registry reviewed a newer CLI together with this adapter.
  private async searchPair(
    cli: AgentToolDefinition,
    adapter: AgentToolDefinition | null,
    signal: AbortSignal,
  ): Promise<void> {
    const cliOutcome = await this.safeOutcome(
      () => this.releases.latest(cli, signal),
      signal,
    );
    if (signal.aborted) return;
    const checkedAt = new Date(this.now()).toISOString();
    const cliRecord = outcomeRecord(cliOutcome, checkedAt);
    if (!adapter) {
      this.records.set(cli.id, cliRecord);
      return;
    }
    const adapterOutcome = await this.safeOutcome(
      () => this.releases.latest(adapter, signal),
      signal,
    );
    if (signal.aborted) return;
    const pair = await this.limitedPair(
      {
        cli,
        adapter,
        cliOutcome,
        adapterOutcome,
        records: {
          cli: cliRecord,
          adapter: outcomeRecord(adapterOutcome, checkedAt),
        },
      },
      signal,
    );
    if (signal.aborted) return;
    this.records.set(cli.id, pair.cli);
    this.records.set(adapter.id, {
      ...pair.adapter,
      target:
        pair.adapter.target && pair.cli.target
          ? { ...pair.adapter.target, cliVersion: pair.cli.target.version }
          : pair.adapter.target,
    });
  }

  // Moves the CLI target below the adapter's declared range, or to the reviewed pair.
  private async limitedPair(
    search: {
      readonly cli: AgentToolDefinition;
      readonly adapter: AgentToolDefinition;
      readonly cliOutcome: AgentToolReleaseOutcome;
      readonly adapterOutcome: AgentToolReleaseOutcome;
      readonly records: {
        readonly cli: AgentToolReleaseRecord;
        readonly adapter: AgentToolReleaseRecord;
      };
    },
    signal: AbortSignal,
  ): Promise<{
    readonly cli: AgentToolReleaseRecord;
    readonly adapter: AgentToolReleaseRecord;
  }> {
    const { cli, adapter, cliOutcome, adapterOutcome, records } = search;
    const range =
      adapterOutcome.ok && cli.packageName
        ? adapterOutcome.release.dependencies[cli.packageName]
        : undefined;
    if (
      !cliOutcome.ok ||
      range === undefined ||
      satisfiesVersionRange(cliOutcome.release.version, range) !== false
    )
      return records;
    const limited = await this.safeOutcome(
      () => this.releases.newestInRange(cli, range, signal),
      signal,
    );
    const reviewed = await this.reviewedPair(
      { cli, adapter, newest: cliOutcome.release.version, limited },
      signal,
    );
    if (reviewed)
      return {
        cli: { ...records.cli, target: reviewed.cli },
        adapter: { ...records.adapter, target: reviewed.adapter },
      };
    return {
      cli: {
        ...records.cli,
        target: limited.ok ? limited.release : null,
        failure: limited.ok ? null : limited.failure,
      },
      adapter: records.adapter,
    };
  }

  // The reviewed CLI and adapter releases, when the range holds the CLI below the reviewed one.
  private async reviewedPair(
    search: {
      readonly cli: AgentToolDefinition;
      readonly adapter: AgentToolDefinition;
      readonly newest: string;
      readonly limited: AgentToolReleaseOutcome;
    },
    signal: AbortSignal,
  ): Promise<{
    readonly cli: AgentToolRelease;
    readonly adapter: AgentToolRelease;
  } | null> {
    const { cli, adapter, newest, limited } = search;
    const reviewed = cli.version ? readStableVersion(cli.version) : null;
    const ceiling = readStableVersion(newest);
    if (!cli.reviewedBeyondAdapterRange || !adapter.version) return null;
    if (!reviewed || !ceiling || compareStableVersions(reviewed, ceiling) > 0)
      return null;
    const held = limited.ok ? readStableVersion(limited.release.version) : null;
    if (held && compareStableVersions(held, reviewed) >= 0) return null;
    const cliRelease = await this.safeOutcome(
      () => this.releases.resolve(cli, cli.version, signal),
      signal,
    );
    const adapterRelease = await this.safeOutcome(
      () => this.releases.resolve(adapter, adapter.version, signal),
      signal,
    );
    return cliRelease.ok && adapterRelease.ok
      ? { cli: cliRelease.release, adapter: adapterRelease.release }
      : null;
  }
}
