/**
 * Limits a ratio to the range from 0 to 1.
 *
 * @param value - Ratio that may lie outside the pad or slider.
 */
export function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}
