import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

/**
 * A whole number that runs to its new value instead of jumping.
 * @param target - The number to show.
 * @param durationMilliseconds - How long the run takes.
 * @returns The number to show now; it counts from the number shown to
 * `target` and slows down towards it. It is `target` at once where the
 * reader asks for less motion.
 */
export function useAnimatedNumber(
  target: number,
  durationMilliseconds: number,
): number {
  const isReduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (isReduced) {
      current.current = target;
      return;
    }
    const from = current.current;
    if (from === target) return;
    const startedAt = performance.now();
    let frame = 0;
    function step(time: number): void {
      const elapsed = Math.max(0, time - startedAt);
      const progress = Math.min(1, elapsed / durationMilliseconds);
      const eased = 1 - (1 - progress) ** 2;
      current.current = Math.round(from + (target - from) * eased);
      setShown(current.current);
      if (progress < 1) frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMilliseconds, isReduced]);

  return isReduced ? target : shown;
}
