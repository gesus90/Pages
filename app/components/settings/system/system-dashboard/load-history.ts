import type { LoadTileKey } from "./load-level";

/** The curves cover the last ten minutes. */
export const HISTORY_WINDOW_MS = 600_000;
/** At most this many readings per tile: ten minutes at one every two seconds. */
export const HISTORY_POINTS = 300;

/**
 * One reading of a tile, or a break where the page was not watched.
 *
 * @remarks
 * A break (`ratio: null`) separates the curve; nothing is drawn across it.
 */
export interface LoadSample {
  /** Milliseconds since the epoch, by the clock of the browser. */
  readonly at: number;
  readonly ratio: number | null;
}

/** The readings of every tile, kept in the memory of the open page only. */
export type LoadHistory = Readonly<Record<LoadTileKey, readonly LoadSample[]>>;

/** No readings yet; a reload starts here. */
export const EMPTY_HISTORY: LoadHistory = {
  processor: [],
  memory: [],
  swap: [],
  agents: [],
};

function appendSamples(
  samples: readonly LoadSample[],
  added: readonly LoadSample[],
  at: number,
): readonly LoadSample[] {
  const oldest = at - HISTORY_WINDOW_MS;
  return [...samples, ...added]
    .filter((sample) => sample.at >= oldest)
    .slice(-HISTORY_POINTS);
}

/**
 * Adds one reading of every tile.
 *
 * @param history - The readings so far.
 * @param ratios - The shares of this reading; `null` where a value is missing.
 * @param options - When it was read and whether the page was hidden before.
 * @returns The new history: older than ten minutes and beyond 300 readings dropped.
 */
export function appendLoadReading(
  history: LoadHistory,
  ratios: Readonly<Record<LoadTileKey, number | null>>,
  options: { readonly at: number; readonly wasHidden: boolean },
): LoadHistory {
  const { at, wasHidden } = options;
  function appendTile(key: LoadTileKey): readonly LoadSample[] {
    const reading: LoadSample = { at, ratio: ratios[key] };
    // The time in the background stays a gap, even a short one.
    const added = wasHidden ? [{ at, ratio: null }, reading] : [reading];
    return appendSamples(history[key], added, at);
  }
  return {
    processor: appendTile("processor"),
    memory: appendTile("memory"),
    swap: appendTile("swap"),
    agents: appendTile("agents"),
  };
}
