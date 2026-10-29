import type { AcpNamespaceOwner } from "@/definition/AcpResource";
import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import type { CliSessionProcess } from "./CliSessionProcess";

/** Connects the owned adapter and reports its registered start. */
export function connectChild(
  child: CliSessionProcess,
  channel: AcpLineChannel,
  start: {
    readonly observer: PlanSessionObserver;
    readonly arguments: readonly string[];
    readonly unattended: string;
    readonly signal: AbortSignal;
    readonly namespace?: AcpNamespaceOwner;
  },
): void {
  channel.attach((line) => child.writeAsync(line));
  const close = (): void => channel.close();
  start.signal.addEventListener("abort", close, { once: true });
  if (start.signal.aborted) close();
  void child.exited.then(() => {
    start.signal.removeEventListener("abort", close);
    channel.close();
  });
  start.observer.started({
    mode: "interactive",
    processId: child.processId,
    startedAt: new Date().toISOString(),
    arguments: start.arguments,
    unattended: start.unattended,
    ...(start.namespace ? { namespace: start.namespace } : {}),
  });
}
