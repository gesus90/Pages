import {
  endTaggedProcesses,
  readScopeSince,
} from "@/backend/agents/cli/CliProcessScan";

/** Ends only processes matching the lease identity and its recorded start boundary. */
export async function endLeaseProcesses(
  instanceId: string,
  startedAt: string | null,
): Promise<{ readonly remaining: number }> {
  const scope = startedAt === null ? null : await readScopeSince(startedAt);
  return endTaggedProcesses(instanceId, scope);
}
