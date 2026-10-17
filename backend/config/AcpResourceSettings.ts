import { readAcpResourceOptions } from "./AcpResourceConfig";

import type { AcpResourceOptions } from "@/definition/AcpResource";
import type { TomlTable } from "smol-toml";

/** Reads optional flat TOML keys while preserving the shape of older configurations. */
export function readAcpResourceSettings(
  table: TomlTable,
): Partial<AcpResourceOptions> {
  const keys = [
    "maxConcurrentAcpSessions",
    "memoryAwareScheduling",
    "minimumAvailableMemory",
    "acpIdleTimeout",
    "queueDiscipline",
  ] as const;
  if (!keys.some((key) => table[key] !== undefined)) return {};
  const maxConcurrentAcpSessions = table.maxConcurrentAcpSessions;
  const memoryAwareScheduling = table.memoryAwareScheduling;
  const minimumAvailableMemory = table.minimumAvailableMemory;
  const acpIdleTimeout = table.acpIdleTimeout;
  if (
    maxConcurrentAcpSessions !== undefined &&
    typeof maxConcurrentAcpSessions !== "number"
  )
    throw new Error("Invalid ACP concurrency");
  if (
    memoryAwareScheduling !== undefined &&
    typeof memoryAwareScheduling !== "boolean"
  )
    throw new Error("Invalid ACP memory check");
  if (
    minimumAvailableMemory !== undefined &&
    typeof minimumAvailableMemory !== "number"
  )
    throw new Error("Invalid ACP memory reserve");
  if (acpIdleTimeout !== undefined && typeof acpIdleTimeout !== "number")
    throw new Error("Invalid ACP idle timeout");
  const settings: Partial<AcpResourceOptions> = {
    ...(maxConcurrentAcpSessions === undefined
      ? {}
      : { maxConcurrentAcpSessions }),
    ...(memoryAwareScheduling === undefined ? {} : { memoryAwareScheduling }),
    ...(minimumAvailableMemory === undefined ? {} : { minimumAvailableMemory }),
    ...(acpIdleTimeout === undefined ? {} : { acpIdleTimeout }),
    ...(table.queueDiscipline === undefined
      ? {}
      : { queueDiscipline: readQueueDiscipline(table.queueDiscipline) }),
  };
  readAcpResourceOptions(settings, {});
  return settings;
}

function readQueueDiscipline(input: unknown): "fifo" {
  if (input !== undefined && input !== "fifo")
    throw new Error("Invalid ACP queue discipline");
  return "fifo";
}
