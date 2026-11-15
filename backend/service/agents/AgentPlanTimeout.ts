import { planPauseGate } from "./AgentPlanPauseGate";

/** A turn deadline counts execution time, so a long pause never cancels its session. */
export function planTurnTimeout(
  runId: string,
  milliseconds: number,
  parent: AbortSignal,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  if (milliseconds <= 0) return { signal: parent, dispose: () => undefined };
  const controller = new AbortController();
  let remaining = milliseconds;
  let observedAt = Date.now();
  let isPaused = false;
  const unlisten = planPauseGate(runId).listen((paused) => {
    isPaused = paused;
    observedAt = Date.now();
  });
  const timer = setInterval(() => {
    const now = Date.now();
    if (!isPaused) remaining -= now - observedAt;
    observedAt = now;
    if (remaining <= 0)
      controller.abort(
        new DOMException("Turn deadline expired", "TimeoutError"),
      );
  }, 100);
  return {
    signal: AbortSignal.any([parent, controller.signal]),
    dispose: () => {
      clearInterval(timer);
      unlisten();
    },
  };
}
