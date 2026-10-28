import { useCallback, useRef, useState } from "react";

/** An unfinished canvas move that an explicit save can capture. */
export interface PendingPlanMove {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** Tracks an in-progress move without changing the draft until an explicit save. */
export interface PlanPendingMove {
  /** Whether the canvas is in an unfinished drag. */
  readonly isMoving: boolean;
  readonly registerPendingMove: (move: PendingPlanMove | null) => void;
  readonly hasPendingMove: () => boolean;
  readonly flushPendingMove: () => void;
}

/** Shares the current drag position with save without committing a cancelled drag. */
export function usePlanPendingMove(
  move: (id: string, x: number, y: number) => void,
): PlanPendingMove {
  const pending = useRef<PendingPlanMove | null>(null);
  const [isMoving, setMoving] = useState(false);
  const registerPendingMove = useCallback((next: PendingPlanMove | null) => {
    pending.current = next;
    setMoving(next !== null);
  }, []);
  const hasPendingMove = useCallback(() => pending.current !== null, []);
  const flushPendingMove = useCallback(() => {
    const current = pending.current;
    if (current) move(current.id, current.x, current.y);
  }, [move]);
  return { isMoving, registerPendingMove, hasPendingMove, flushPendingMove };
}
