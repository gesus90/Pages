import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

/** Waits for the group's earlier turns; a stop while waiting cancels the node before it starts. */
export async function waitForTurn(
  ready: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let stop: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    stop = () => resolve();
    signal.addEventListener("abort", stop, { once: true });
  });
  try {
    if (!signal.aborted) await Promise.race([ready, stopped]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
  if (signal.aborted) throw new AgentPlanCancelledError();
}
