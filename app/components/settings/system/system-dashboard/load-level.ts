import { MAX_ACP_SESSIONS } from "@/definition/AcpResource";

import type { SystemDashboard } from "@/definition/SystemDashboard";

/** How full a resource is; rings, bars and curves share the colors. */
export type LoadLevel = "normal" | "elevated" | "high" | "critical";

/** The lower bounds of the levels above `normal`, as shares from 0 to 1. */
export const LOAD_THRESHOLDS: Readonly<
  Record<Exclude<LoadLevel, "normal">, number>
> = {
  elevated: 0.6,
  high: 0.8,
  critical: 0.9,
};

/** The stroke of each level, for rings and curves. */
export const LOAD_STROKES: Readonly<Record<LoadLevel, string>> = {
  normal: "stroke-load-normal",
  elevated: "stroke-load-elevated",
  high: "stroke-load-high",
  critical: "stroke-load-critical",
};

/** The gradient stop of each level, for the curves. */
export const LOAD_STOP_COLORS: Readonly<Record<LoadLevel, string>> = {
  normal: "[stop-color:var(--color-load-normal)]",
  elevated: "[stop-color:var(--color-load-elevated)]",
  high: "[stop-color:var(--color-load-high)]",
  critical: "[stop-color:var(--color-load-critical)]",
};

/** The fill of each level, for bars. */
export const LOAD_FILLS: Readonly<Record<LoadLevel, string>> = {
  normal: "bg-load-normal",
  elevated: "bg-load-elevated",
  high: "bg-load-high",
  critical: "bg-load-critical",
};

/** The tiles of the load section, in their order. */
export type LoadTileKey = "processor" | "memory" | "swap" | "agents";

/**
 * Tells the level of a share as it is shown.
 *
 * @param ratio - Share from 0 to 1.
 * @returns The level of the rounded percentage, so `59.6 %` shown as `60 %`
 * already counts as elevated.
 */
export function loadLevel(ratio: number): LoadLevel {
  const shown = Math.round(ratio * 100) / 100;
  if (shown >= LOAD_THRESHOLDS.critical) return "critical";
  if (shown >= LOAD_THRESHOLDS.high) return "high";
  if (shown >= LOAD_THRESHOLDS.elevated) return "elevated";
  return "normal";
}

/**
 * The effective ceiling of ACP instances.
 *
 * @param maximum - The configured "maximum ACP instances".
 * @returns The configured value; `0` stands for the absolute ceiling.
 */
export function acpCeiling(maximum: number): number {
  return maximum === 0 ? MAX_ACP_SESSIONS : maximum;
}

function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.min(1, Math.max(0, part / whole)) : null;
}

/**
 * Reads the share of every tile from one measurement.
 *
 * @param dashboard - The measurement.
 * @returns Shares from 0 to 1; `null` where a value is missing.
 */
export function readLoadRatios(
  dashboard: SystemDashboard,
): Readonly<Record<LoadTileKey, number | null>> {
  const { processor, memory, swap, agents } = dashboard;
  return {
    processor: processor.usage,
    memory: memory
      ? share(memory.total - memory.available, memory.total)
      : null,
    swap: swap ? share(swap.used, swap.total) : null,
    agents: agents ? share(agents.active, acpCeiling(agents.maximum)) : null,
  };
}
