import type { RunnerRecord } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RemoteConnectionView } from "@/definition/RemoteConnection";
import type { ToolInventory } from "@/definition/RemoteSetup";
import type { RunnerConnectionView } from "@/definition/RunnerProtocol";

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

/** Projects a visible connection and its live runner facts without credentials. */
export function runnerConnectionView(
  connection: RemoteConnectionView,
  record: RunnerRecord | null,
  facts: {
    readonly outputJournalVersion: 1 | 2 | null;
    readonly isOnline: boolean;
    readonly tools: readonly ToolInventory[] | undefined;
  },
): RunnerConnectionView {
  const runner =
    record?.connectionRevision === connection.revision ? record : null;
  return {
    connectionId: connection.id,
    name: connection.name,
    endpoint: `${connection.username}@${connection.host}:${connection.port}`,
    departmentName: connection.departmentName,
    checkedAt: connection.lastCheck?.checkedAt ?? null,
    isStable: isStableConnection(connection),
    runnerId: record?.runnerId ?? null,
    needsPairing: record !== null && runner === null,
    isOnline: runner !== null && facts.isOnline,
    tools: runnerTools(runner, facts.tools),
    outputJournalVersion: facts.outputJournalVersion,
    runnerVersion: record?.state.runnerVersion ?? null,
    communicationVersion: record?.state.communicationVersion ?? null,
  };
}
