import { planPauseGate } from "./AgentPlanPauseGate";

/** Cancels an in-flight request on Pause and repeats that turn with the same session input on Resume. */
export async function runPausablePlanRequest<T>(
  runId: string,
  signal: AbortSignal,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const gate = planPauseGate(runId);
  for (;;) {
    await gate.wait(signal);
    const controller = new AbortController();
    let wasPaused = false;
    const unlisten = gate.listen((paused) => {
      if (!paused) return;
      wasPaused = true;
      controller.abort();
    });
    try {
      const result = await request(
        AbortSignal.any([signal, controller.signal]),
      );
      if (!wasPaused) return result;
    } catch (error: unknown) {
      if (!wasPaused || signal.aborted) throw error;
    } finally {
      unlisten();
    }
  }
}
