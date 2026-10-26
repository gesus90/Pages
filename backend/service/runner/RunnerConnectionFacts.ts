import type { RunnerRecord } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RemoteConnectionView } from "@/definition/RemoteConnection";
import type { ToolInventory } from "@/definition/RemoteSetup";

/** A connected, checked connection that has stayed up for five seconds. */
export function isStableConnection(connection: RemoteConnectionView): boolean {
  return (
    connection.session.status === "connected" &&
    connection.hostKey !== null &&
    !connection.isChecking &&
    connection.lastCheck?.code === null &&
    Date.now() - Date.parse(connection.session.connectedAt ?? "") >= 5000
  );
}

/** Runner 1.10 probes its tools after registration; its catalog holds the latest probe. */
export function runnerTools(
  runner: RunnerRecord | null,
  reported: readonly ToolInventory[] | undefined,
): readonly ToolInventory[] | null {
  if (!runner) return null;
  if (runner.state.communicationVersion === 1)
    return runner.state.catalog?.tools ?? null;
  return reported ?? null;
}
