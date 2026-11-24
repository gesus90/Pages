import {
  compareStableVersions,
  readStableVersion,
  satisfiesVersionRange,
} from "@/definition/AgentToolVersion";

import { AGENT_TOOL_REGISTRY, agentToolDefinition } from "./AgentToolRegistry";

import type {
  AgentToolId,
  AgentToolReleaseView,
  AgentToolUpdateState,
} from "@/definition/AgentTools";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type {
  AgentToolReleaseCheck,
  AgentToolReleaseFailure,
  AgentToolReleaseOutcome,
} from "./AgentToolReleaseCheck";
import type { AgentToolRelease } from "./AgentToolContracts";

/** What one update search found for one tool. */
interface ReleaseRecord {
  readonly checkedAt: string;
  readonly latest: AgentToolRelease | null;
  /** What an update installs; older than `latest` when the adapter limits its CLI. */
  readonly target: AgentToolRelease | null;
  readonly failure: AgentToolReleaseFailure | null;
}

/** The generation new sessions use, as the update state compares it. */
export interface AgentToolActiveRelease {
  readonly version: string | null;
  readonly source: "managed" | "system" | "bundled" | null;
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
): ReleaseRecord {
  return outcome.ok
    ? {
        checkedAt,
        latest: outcome.release,
        target: outcome.release,
        failure: null,
      }
    : { checkedAt, latest: null, target: null, failure: outcome.failure };
}

/**
 * Reads release metadata on an explicit request and keeps what it found.
 * @remarks
 * Searching never installs or activates anything; it only names the target
 * an administrator's later update installs.
 */
export class AgentToolUpdateSearch {
  private readonly releases: AgentToolReleaseCheck;
  private readonly records = new Map<AgentToolId, ReleaseRecord>();
  private running: Promise<void> | null = null;

  public constructor(releases: AgentToolReleaseCheck) {
    this.releases = releases;
  }

  /** Reads every fixed source once; a second request joins a running search. */
  public search(signal: AbortSignal): Promise<void> {
    this.running ??= this.run(signal).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** The release the last search chose for an update, if it found one. */
  public target(id: AgentToolId): AgentToolRelease | null {
    return this.records.get(id)?.target ?? null;
  }

  /** Whether an update search ran for this tool since the server started. */
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
    record: ReleaseRecord,
    active: AgentToolActiveRelease,
  ): AgentToolUpdateState {
    if (record.failure) return FAILURE_STATES[record.failure];
    if (active.source === "system") return "external";
    const target = record.target
      ? readStableVersion(record.target.version)
      : null;
    const current = active.version ? readStableVersion(active.version) : null;
    if (!target) return "check_failed";
    if (!current) return "update_available";
    return compareStableVersions(target, current) > 0
      ? "update_available"
      : "current";
  }

  private async run(signal: AbortSignal): Promise<void> {
    for (const tool of AGENT_TOOL_REGISTRY) {
      if (!tool.release || this.isAdapter(tool)) continue;
      const adapter = tool.adapter ? agentToolDefinition(tool.adapter) : null;
      await this.searchPair(tool, adapter, signal);
    }
  }

  private isAdapter(tool: AgentToolDefinition): boolean {
    return AGENT_TOOL_REGISTRY.some((entry) => entry.adapter === tool.id);
  }

  // The adapter's declared CLI range decides which CLI release the pair moves to,
  // unless the registry reviewed a newer CLI together with this adapter.
  private async searchPair(
    cli: AgentToolDefinition,
    adapter: AgentToolDefinition | null,
    signal: AbortSignal,
  ): Promise<void> {
    const cliOutcome = await this.releases.latest(cli, signal);
    const checkedAt = new Date().toISOString();
    const cliRecord = outcomeRecord(cliOutcome, checkedAt);
    if (!adapter) {
      this.records.set(cli.id, cliRecord);
      return;
    }
    const adapterOutcome = await this.releases.latest(adapter, signal);
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
        readonly cli: ReleaseRecord;
        readonly adapter: ReleaseRecord;
      };
    },
    signal: AbortSignal,
  ): Promise<{
    readonly cli: ReleaseRecord;
    readonly adapter: ReleaseRecord;
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
    const limited = await this.releases.newestInRange(cli, range, signal);
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
    const cliRelease = await this.releases.resolve(cli, cli.version, signal);
    const adapterRelease = await this.releases.resolve(
      adapter,
      adapter.version,
      signal,
    );
    return cliRelease.ok && adapterRelease.ok
      ? { cli: cliRelease.release, adapter: adapterRelease.release }
      : null;
  }
}
