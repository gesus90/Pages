import { logCaughtError } from "@/backend/logging/Logger";
import { systemDashboardSchema } from "@/definition/SystemDashboard";
import { PAGES_VERSION } from "@/definition/Version";

import { readDeploymentBuild } from "./DeploymentBuild";
import { PeriodicValue } from "./PeriodicValue";
import { SystemDiskMonitor } from "./SystemDiskMonitor";
import { SystemLoadSampler } from "./SystemLoadSampler";

import type { AccountAccess } from "@/definition/Authorization";
import type { AgentToolView } from "@/definition/AgentTools";
import type {
  DashboardAgents,
  DashboardBuild,
  DashboardFacts,
  SystemDashboard,
} from "@/definition/SystemDashboard";
import type { SystemSources } from "./SystemSources";

/** All open pages share one measurement for this long after it finished. */
const SHARED_FOR_MS = 1000;
const DATABASE_SIZE_INTERVAL_MS = 60_000;
const DATA_DIRECTORY_INTERVAL_MS = 15 * 60_000;
/** `du` over a large data directory may take a while; it never takes longer. */
const DATA_DIRECTORY_TIMEOUT_MS = 120_000;
const TOOLS_INTERVAL_MS = 60_000;

/** The occupied ACP instances of the whole instance and the configured maximum. */
export interface AcpOccupancy {
  readonly active: number;
  /** "Maximum ACP instances"; `0` means no limit of its own. */
  readonly maximum: number;
}

/** What the dashboard reads besides the system sources. */
export interface SystemDashboardDependencies {
  readonly sources: SystemSources;
  /** The data directory of the instance, whose size the fact line shows. */
  readonly dataDirectory: string;
  /** The size of the PostgreSQL database in bytes. */
  readonly readDatabaseSize: () => Promise<number>;
  /** The occupancy the "ACP resources" card shows. */
  readonly readAcpOccupancy: () => Promise<AcpOccupancy>;
  /** The tools of Settings → Agents → Tools; checks the actor itself. */
  readonly listTools: (actor: AccountAccess) => readonly AgentToolView[];
}

interface Measurement {
  readonly result: Promise<SystemDashboard>;
  settledAt: number | null;
}

interface ToolReadiness {
  readonly ready: number;
  readonly total: number;
}

/** Counts the enabled tools and those of them that are ready. */
function countReadyTools(tools: readonly AgentToolView[]): ToolReadiness {
  const enabled = tools.filter((tool) => tool.enabled);
  return {
    ready: enabled.filter((tool) => tool.status === "ready").length,
    total: enabled.length,
  };
}

function readBytes(text: string | null): number | null {
  const bytes = Number(text?.trim());
  return text !== null && Number.isSafeInteger(bytes) && bytes >= 0
    ? bytes
    : null;
}

/**
 * Measures the server for the system dashboard (PAGE-282).
 *
 * @remarks
 * One measurement serves every open page for a second after it finished, and
 * a measurement under way serves every request that arrives meanwhile.
 * Database size, data directory size and tool readiness are computed in the
 * background at most once per interval and are `null` until their first
 * result. Nothing of the measurements is kept as a history; the pages keep
 * their curves themselves.
 */
export class SystemDashboardService {
  private readonly dependencies: SystemDashboardDependencies;
  private readonly sampler: SystemLoadSampler;
  private readonly disks: SystemDiskMonitor;
  private readonly databaseSize: PeriodicValue<number>;
  private readonly dataDirectorySize: PeriodicValue<number>;
  private readonly tools: PeriodicValue<ToolReadiness>;
  private measurement: Measurement | null = null;

  /**
   * Creates the service; nothing is measured before the first request.
   *
   * @param dependencies - Sources, data directory and the instance's readers.
   */
  public constructor(dependencies: SystemDashboardDependencies) {
    const { now } = dependencies.sources;
    this.dependencies = dependencies;
    this.sampler = new SystemLoadSampler(dependencies.sources);
    this.disks = new SystemDiskMonitor(dependencies.sources);
    this.databaseSize = new PeriodicValue({
      intervalMs: DATABASE_SIZE_INTERVAL_MS,
      component: "SystemDashboard.databaseSize",
      now,
    });
    this.dataDirectorySize = new PeriodicValue({
      intervalMs: DATA_DIRECTORY_INTERVAL_MS,
      component: "SystemDashboard.dataDirectorySize",
      now,
    });
    this.tools = new PeriodicValue({
      intervalMs: TOOLS_INTERVAL_MS,
      component: "SystemDashboard.tools",
      now,
    });
  }

  /**
   * Answers the current measurement, shared with the other open pages.
   *
   * @param actor - An administrator in the active admin mode; the caller checked it.
   * @returns The measurement, checked against {@link systemDashboardSchema}.
   */
  public read(actor: AccountAccess): Promise<SystemDashboard> {
    const { now } = this.dependencies.sources;
    const last = this.measurement;
    if (
      last !== null &&
      (last.settledAt === null || now() - last.settledAt < SHARED_FOR_MS)
    )
      return last.result;
    const measurement: Measurement = {
      result: this.measure(actor),
      settledAt: null,
    };
    function settle(): void {
      measurement.settledAt = now();
    }
    void measurement.result.then(settle, settle);
    this.measurement = measurement;
    return measurement.result;
  }

  private async measure(actor: AccountAccess): Promise<SystemDashboard> {
    const [load, disks, agents, build] = await Promise.all([
      this.sampler.read(),
      this.disks.read(),
      this.readAgents(),
      readDeploymentBuild(this.dependencies.sources.readText),
    ]);
    return systemDashboardSchema.parse({
      measuredAt: this.dependencies.sources.now(),
      processor: load.processor,
      memory: load.memory,
      swap: load.swap,
      agents,
      disks,
      facts: this.readFacts(actor, load.serverStartedAt, build),
    });
  }

  private async readAgents(): Promise<DashboardAgents | null> {
    try {
      const [occupancy, memory] = await Promise.all([
        this.dependencies.readAcpOccupancy(),
        this.readAcpMemory(),
      ]);
      return { ...occupancy, memory };
    } catch (error: unknown) {
      logCaughtError("SystemDashboard.agents", error);
      return null;
    }
  }

  /** `memory.current` of `pages-acp.slice` in the user manager of the account running Pages. */
  private async readAcpMemory(): Promise<number | null> {
    const { userId, readText } = this.dependencies.sources;
    if (userId === null) return null;
    return readBytes(
      await readText(
        `/sys/fs/cgroup/user.slice/user-${userId}.slice/user@${userId}.service/pages.slice/pages-acp.slice/memory.current`,
      ),
    );
  }

  private readFacts(
    actor: AccountAccess,
    serverStartedAt: number | null,
    build: DashboardBuild | null,
  ): DashboardFacts {
    const { sources, dataDirectory, readDatabaseSize, listTools } =
      this.dependencies;
    const now = sources.now();
    return {
      version: PAGES_VERSION,
      build,
      nodeVersion: process.versions.node,
      // Whole seconds keep the start time steady between readings.
      pagesStartedAt: Math.round((now - process.uptime() * 1000) / 1000) * 1000,
      serverStartedAt,
      databaseSize: this.databaseSize.current(readDatabaseSize),
      dataDirectorySize: this.dataDirectorySize.current(() =>
        sources.measureDirectory(dataDirectory, DATA_DIRECTORY_TIMEOUT_MS),
      ),
      tools: this.tools.current(async () => countReadyTools(listTools(actor))),
    };
  }
}
