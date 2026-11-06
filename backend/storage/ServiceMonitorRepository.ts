import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { serviceMonitorStateSchema } from "@/definition/ServiceMonitor";

import type { ServiceMonitorState } from "@/definition/ServiceMonitor";

/** Atomic file persistence keeps restart warnings independent of both PostgreSQL and API uptime. */
export class ServiceMonitorRepository {
  private readonly file: string;

  /** Uses the same private data directory as the configured Pages instance. */
  public constructor(directory: string) {
    this.file = path.join(directory, "service-monitor", "status.json");
  }

  /** Returns a validated checkpoint, or null before the detector's first observation. */
  public async read(): Promise<ServiceMonitorState | null> {
    try {
      return serviceMonitorStateSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    }
  }

  /** Replaces a complete checkpoint; only the independently scheduled detector writes it. */
  public async write(state: ServiceMonitorState): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const pending = `${this.file}.${process.pid}.pending`;
    await writeFile(
      pending,
      JSON.stringify(serviceMonitorStateSchema.parse(state)),
      { mode: 0o600 },
    );
    await rename(pending, this.file);
  }
}
