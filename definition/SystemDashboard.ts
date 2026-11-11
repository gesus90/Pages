import { z } from "zod";

/** The endpoint of the system dashboard; only for a session in the active admin mode (PAGE-282). */
export const SYSTEM_DASHBOARD_PATH = "/settings-api/system/dashboard";

/** Mounted file systems beyond this number are not listed. */
export const MAXIMUM_DASHBOARD_DISKS = 64;

const bytesSchema = z.number().int().nonnegative();
const countSchema = z.number().int().nonnegative();
const instantSchema = z.number().int().nonnegative();

/**
 * The processor: busy share between two readings of `/proc/stat`, the
 * one-minute load, the number of cores and the package temperature.
 */
export const dashboardProcessorSchema = z.strictObject({
  /** Busy share from 0 to 1; `null` when `/proc/stat` cannot be read. */
  usage: z.number().min(0).max(1).nullable(),
  /** One-minute load average from `/proc/loadavg`. */
  load: z.number().nonnegative().nullable(),
  cores: countSchema,
  /** Degrees Celsius; `null` without a temperature source. */
  temperature: z.number().min(-100).max(250).nullable(),
});

/** The memory from `/proc/meminfo`; used is `total - available`. */
export const dashboardMemorySchema = z.strictObject({
  total: bytesSchema,
  available: bytesSchema,
});

/** The swap space; the dashboard leaves it out where none is set up. */
export const dashboardSwapSchema = z.strictObject({
  total: bytesSchema,
  used: bytesSchema,
  /**
   * Whether `pswpin` or `pswpout` of `/proc/vmstat` changed between two
   * readings; `null` when they cannot be read.
   */
  isSwapping: z.boolean().nullable(),
});

/** The occupied ACP instances and the memory of all ACP sessions. */
export const dashboardAgentsSchema = z.strictObject({
  active: countSchema,
  /** The configured "maximum ACP instances"; `0` means no limit of its own. */
  maximum: countSchema,
  /** `memory.current` of `pages-acp.slice`; `null` without that control group. */
  memory: bytesSchema.nullable(),
});

/**
 * One mounted file system, named by its mount point only.
 *
 * @remarks
 * Neither the source (which may name a share with its user) nor the mount
 * options leave the server.
 */
export const dashboardDiskSchema = z.discriminatedUnion("isReachable", [
  z.strictObject({
    mountPoint: z.string().min(1).max(4096),
    isReachable: z.literal(true),
    size: bytesSchema,
    used: bytesSchema,
    /** Space available to unprivileged processes, as `df` reports it. */
    free: bytesSchema,
  }),
  z.strictObject({
    mountPoint: z.string().min(1).max(4096),
    isReachable: z.literal(false),
  }),
]);

/** The facts below the panels; expensive ones are `null` until first measured. */
export const dashboardFactsSchema = z.strictObject({
  version: z.string().max(64),
  nodeVersion: z.string().max(64),
  /** When this Pages process started, in milliseconds since the epoch. */
  pagesStartedAt: instantSchema,
  /** When the server booted; `null` when `/proc/uptime` cannot be read. */
  serverStartedAt: instantSchema.nullable(),
  databaseSize: bytesSchema.nullable(),
  dataDirectorySize: bytesSchema.nullable(),
  /** Ready and enabled agent tools of Settings → Agents → Tools. */
  tools: z.strictObject({ ready: countSchema, total: countSchema }).nullable(),
});

/** One measurement of the system dashboard, shared by all open pages for a second. */
export const systemDashboardSchema = z.strictObject({
  measuredAt: instantSchema,
  processor: dashboardProcessorSchema,
  /** `null` when `/proc/meminfo` cannot be read. */
  memory: dashboardMemorySchema.nullable(),
  /** `null` without swap space. */
  swap: dashboardSwapSchema.nullable(),
  /** `null` when the ACP occupancy cannot be read. */
  agents: dashboardAgentsSchema.nullable(),
  disks: z.array(dashboardDiskSchema).max(MAXIMUM_DASHBOARD_DISKS),
  facts: dashboardFactsSchema,
});

/** One measurement of the system dashboard, see {@link systemDashboardSchema}. */
export type SystemDashboard = z.infer<typeof systemDashboardSchema>;

/** The processor tile, see {@link dashboardProcessorSchema}. */
export type DashboardProcessor = z.infer<typeof dashboardProcessorSchema>;

/** The memory tile, see {@link dashboardMemorySchema}. */
export type DashboardMemory = z.infer<typeof dashboardMemorySchema>;

/** The swap tile, see {@link dashboardSwapSchema}. */
export type DashboardSwap = z.infer<typeof dashboardSwapSchema>;

/** The agents tile, see {@link dashboardAgentsSchema}. */
export type DashboardAgents = z.infer<typeof dashboardAgentsSchema>;

/** One file system of the list, see {@link dashboardDiskSchema}. */
export type DashboardDisk = z.infer<typeof dashboardDiskSchema>;

/** The fact line, see {@link dashboardFactsSchema}. */
export type DashboardFacts = z.infer<typeof dashboardFactsSchema>;
