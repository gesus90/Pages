import type { AcpResourceOptions } from "@/definition/AcpResource";

/** Conservative native process defaults for the N100 / 8 GiB installation. */
export const DEFAULT_ACP_RESOURCES: AcpResourceOptions = {
  maxConcurrentAcpSessions: 1,
  memoryAwareScheduling: true,
  minimumAvailableMemory: 2048,
  acpIdleTimeout: 300_000,
  queueDiscipline: "fifo",
};

function integer(input: unknown, name: string, minimum: number): number {
  const result = typeof input === "string" ? Number(input) : input;
  if (
    typeof result !== "number" ||
    !Number.isSafeInteger(result) ||
    result < minimum
  )
    throw new Error(`Invalid ACP resource setting: ${name}`);
  return result;
}

function boolean(input: unknown): boolean {
  if (input === true || input === "true" || input === "1") return true;
  if (input === false || input === "false" || input === "0") return false;
  throw new Error("Invalid ACP resource setting: memoryAwareScheduling");
}

/** Validates TOML settings and optional environment overrides without coercing invalid values. */
export function readAcpResourceOptions(
  settings: Partial<AcpResourceOptions> = {},
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AcpResourceOptions {
  const options = { ...DEFAULT_ACP_RESOURCES, ...settings };
  if (options.queueDiscipline !== "fifo")
    throw new Error("Invalid ACP resource setting: queueDiscipline");
  return {
    maxConcurrentAcpSessions: integer(
      environment.PAGES_MAX_CONCURRENT_ACP_SESSIONS ??
        options.maxConcurrentAcpSessions,
      "maxConcurrentAcpSessions",
      1,
    ),
    memoryAwareScheduling: boolean(
      environment.PAGES_ACP_MEMORY_AWARE ?? options.memoryAwareScheduling,
    ),
    minimumAvailableMemory: integer(
      environment.PAGES_ACP_MIN_AVAILABLE_MEMORY_MB ??
        options.minimumAvailableMemory,
      "minimumAvailableMemory",
      0,
    ),
    acpIdleTimeout: integer(options.acpIdleTimeout, "acpIdleTimeout", 1),
    queueDiscipline: "fifo",
  };
}
