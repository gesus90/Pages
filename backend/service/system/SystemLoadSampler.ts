import type {
  DashboardMemory,
  DashboardProcessor,
  DashboardSwap,
} from "@/definition/SystemDashboard";
import type { SystemSources } from "./SystemSources";

/** Without a recent reading, the second one follows after this short window. */
const SHORT_WINDOW_MS = 250;
/** An older reading would average over a time no one watched. */
const MAXIMUM_PAIR_AGE_MS = 10_000;
/** A missing temperature source is looked for again after this time. */
const TEMPERATURE_LOOKUP_MS = 300_000;
const TEMPERATURE_ZONE_TYPE = "x86_pkg_temp";
const TEMPERATURE_SENSOR_NAMES: ReadonlySet<string> = new Set([
  "coretemp",
  "k10temp",
]);
const THERMAL_DIRECTORY = "/sys/class/thermal";
const HWMON_DIRECTORY = "/sys/class/hwmon";
const KIBIBYTE = 1024;

interface ProcessorCounters {
  readonly busy: number;
  readonly total: number;
  readonly cores: number;
}

/** The counters that only mean something as a difference between two readings. */
interface Counters {
  readonly at: number;
  readonly processor: ProcessorCounters | null;
  /** `pswpin + pswpout` of `/proc/vmstat`. */
  readonly swappedPages: number | null;
}

/** What the load tiles show, from one pair of readings. */
export interface LoadReading {
  readonly processor: DashboardProcessor;
  readonly memory: DashboardMemory | null;
  readonly swap: DashboardSwap | null;
  readonly serverStartedAt: number | null;
}

interface TemperatureSource {
  readonly path: string | null;
  readonly foundAt: number;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Reads the aggregate `cpu` line: idle and I/O wait are idle time, the rest is busy. */
function readProcessorCounters(stat: string | null): ProcessorCounters | null {
  if (stat === null) return null;
  const fields = /^cpu\s+(.+)$/mu
    .exec(stat)?.[1]
    ?.trim()
    .split(/\s+/u)
    .slice(0, 8)
    .map(Number);
  if (fields?.length !== 8 || !fields.every(Number.isFinite)) return null;
  const total = sum(fields);
  const idle = (fields[3] ?? 0) + (fields[4] ?? 0);
  return {
    busy: total - idle,
    total,
    cores: stat.match(/^cpu\d+\s/gmu)?.length ?? 0,
  };
}

function readVmCounter(vmstat: string, name: string): number | null {
  const match = new RegExp(`^${name}\\s+(\\d+)$`, "mu").exec(vmstat);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function readSwappedPages(vmstat: string | null): number | null {
  if (vmstat === null) return null;
  const swappedIn = readVmCounter(vmstat, "pswpin");
  const swappedOut = readVmCounter(vmstat, "pswpout");
  return swappedIn === null || swappedOut === null
    ? null
    : swappedIn + swappedOut;
}

/** Reads one `/proc/meminfo` field in bytes. */
function readMemoryField(meminfo: string, name: string): number | null {
  const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, "mu").exec(meminfo);
  return match?.[1] === undefined ? null : Number(match[1]) * KIBIBYTE;
}

function readMemory(meminfo: string | null): DashboardMemory | null {
  if (meminfo === null) return null;
  const total = readMemoryField(meminfo, "MemTotal");
  const available = readMemoryField(meminfo, "MemAvailable");
  if (total === null || available === null || total === 0) return null;
  return { total, available: Math.min(available, total) };
}

function readSwap(
  meminfo: string | null,
  before: Counters,
  after: Counters,
): DashboardSwap | null {
  if (meminfo === null) return null;
  const total = readMemoryField(meminfo, "SwapTotal");
  const free = readMemoryField(meminfo, "SwapFree");
  if (total === null || free === null || total === 0) return null;
  const isSwapping =
    before.swappedPages === null || after.swappedPages === null
      ? null
      : after.swappedPages !== before.swappedPages;
  return { total, used: Math.max(0, total - free), isSwapping };
}

function readUsage(before: Counters, after: Counters): number | null {
  if (before.processor === null || after.processor === null) return null;
  const total = after.processor.total - before.processor.total;
  const busy = after.processor.busy - before.processor.busy;
  if (total <= 0) return null;
  return Math.min(1, Math.max(0, busy / total));
}

function readLoad(loadavg: string | null): number | null {
  const load = Number(loadavg?.split(/\s+/u)[0]);
  return loadavg !== null && Number.isFinite(load) && load >= 0 ? load : null;
}

function readServerStart(uptime: string | null, now: number): number | null {
  const seconds = Number(uptime?.split(/\s+/u)[0]);
  if (uptime === null || !Number.isFinite(seconds) || seconds < 0) return null;
  // Whole seconds keep the boot time steady between readings.
  return Math.round((now - seconds * 1000) / 1000) * 1000;
}

function readCelsius(text: string | null): number | null {
  const millidegrees = Number(text?.trim());
  if (text === null || !Number.isFinite(millidegrees)) return null;
  const celsius = Math.round(millidegrees / 100) / 10;
  return celsius >= -100 && celsius <= 250 ? celsius : null;
}

function byNumber(first: string, second: string): number {
  return first.localeCompare(second, "en", { numeric: true });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Measures processor, memory and swap from `/proc` and the package temperature from `/sys`.
 *
 * @remarks
 * Processor busy share and swapping are differences between two readings.
 * The reading of the previous measurement serves as the first one when it is
 * recent; otherwise a second reading follows after a short window. No
 * history is kept beyond that one reading.
 */
export class SystemLoadSampler {
  private readonly sources: SystemSources;
  private previous: Counters | null = null;
  private temperatureSource: TemperatureSource | null = null;

  /**
   * Creates the sampler.
   *
   * @param sources - Readers of `/proc` and `/sys`.
   */
  public constructor(sources: SystemSources) {
    this.sources = sources;
  }

  /** Measures the load tiles and the boot time of the server. */
  public async read(): Promise<LoadReading> {
    const [before, after] = await this.readCounterPair();
    const [meminfo, loadavg, uptime, temperature] = await Promise.all([
      this.sources.readText("/proc/meminfo"),
      this.sources.readText("/proc/loadavg"),
      this.sources.readText("/proc/uptime"),
      this.readTemperature(),
    ]);
    return {
      processor: {
        usage: readUsage(before, after),
        load: readLoad(loadavg),
        cores: after.processor?.cores ?? 0,
        temperature,
      },
      memory: readMemory(meminfo),
      swap: readSwap(meminfo, before, after),
      serverStartedAt: readServerStart(uptime, this.sources.now()),
    };
  }

  private async readCounterPair(): Promise<readonly [Counters, Counters]> {
    const current = await this.readCounters();
    const previous = this.previous;
    if (previous !== null && current.at - previous.at <= MAXIMUM_PAIR_AGE_MS) {
      this.previous = current;
      return [previous, current];
    }
    await delay(SHORT_WINDOW_MS);
    const next = await this.readCounters();
    this.previous = next;
    return [current, next];
  }

  private async readCounters(): Promise<Counters> {
    const [stat, vmstat] = await Promise.all([
      this.sources.readText("/proc/stat"),
      this.sources.readText("/proc/vmstat"),
    ]);
    return {
      at: this.sources.now(),
      processor: readProcessorCounters(stat),
      swappedPages: readSwappedPages(vmstat),
    };
  }

  private async readTemperature(): Promise<number | null> {
    const now = this.sources.now();
    const known = this.temperatureSource;
    const isStale =
      known === null ||
      (known.path === null && now - known.foundAt >= TEMPERATURE_LOOKUP_MS);
    const source = isStale
      ? { path: await this.findTemperatureSource(), foundAt: now }
      : known;
    this.temperatureSource = source;
    if (source.path === null) return null;
    const celsius = readCelsius(await this.sources.readText(source.path));
    // A sensor that disappeared is looked for again with the next reading.
    if (celsius === null) this.temperatureSource = null;
    return celsius;
  }

  /** The package zone of the thermal framework first, then the first CPU sensor of hwmon. */
  private async findTemperatureSource(): Promise<string | null> {
    const zones = (await this.sources.listDirectory(THERMAL_DIRECTORY))
      .filter((entry) => entry.startsWith("thermal_zone"))
      .toSorted(byNumber);
    for (const zone of zones) {
      const type = await this.sources.readText(
        `${THERMAL_DIRECTORY}/${zone}/type`,
      );
      if (type?.trim() === TEMPERATURE_ZONE_TYPE)
        return `${THERMAL_DIRECTORY}/${zone}/temp`;
    }
    const sensors = (
      await this.sources.listDirectory(HWMON_DIRECTORY)
    ).toSorted(byNumber);
    for (const sensor of sensors) {
      const name = await this.sources.readText(
        `${HWMON_DIRECTORY}/${sensor}/name`,
      );
      if (name !== null && TEMPERATURE_SENSOR_NAMES.has(name.trim()))
        return `${HWMON_DIRECTORY}/${sensor}/temp1_input`;
    }
    return null;
  }
}
