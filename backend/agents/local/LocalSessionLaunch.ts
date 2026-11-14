import { randomUUID } from "node:crypto";
import path from "node:path";

import { requireAgentFiles } from "@/backend/storage/AgentPayloadFileStore";
import { AgentError } from "@/backend/error/AgentErrors";

import {
  localLaunchSchema,
  localMutationSchema,
} from "./LocalSessionContracts";
import { proveLocalOwner } from "./LocalSessionOwnership";
import { readLocalRecord } from "./LocalSessionFiles";

import type { Database } from "@/backend/database/Database";
import type {
  LocalSessionEntry,
  LocalSessionRepository,
} from "@/backend/database/repositories/agent/LocalSessionRepository";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type {
  LocalSessionLaunch,
  LocalSessionMutation,
} from "./LocalSessionContracts";

/** Resolves the instance-local directory of one native session owner. */
export function localSessionDirectory(
  dataDirectory: string,
  instanceId: string,
): string {
  if (!/^[a-f0-9-]{36}$/u.test(instanceId))
    throw new AgentError("plan_local_owner_unverified");
  return path.join(dataDirectory, "local-sessions", instanceId);
}

/** Builds and validates the launch contract for a local native session or turn. */
export function createLocalSessionLaunch(
  input: AgentPlanExecutionInput,
  instanceId: string,
  mcp: {
    readonly url: string;
    readonly tools: readonly string[] | null;
  } | null,
  timeoutMinutes: number,
): LocalSessionLaunch {
  const recording = input.recording;
  if (!recording || recording.instanceId !== instanceId)
    throw new AgentError("plan_context_changed");
  const isInstruction = input.resourceContext?.isLocalInstruction === true;
  const launch = localLaunchSchema.safeParse({
    runId: recording.key.runId,
    stepId: recording.key.stepId,
    sessionScopeId:
      input.resourceContext?.sessionScopeId ?? recording.key.stepId,
    attemptId: recording.key.attemptId,
    turnId: isInstruction ? randomUUID() : recording.key.attemptId,
    isInstruction,
    instanceId,
    userId: input.userId,
    prompt: input.prompt,
    instruction: input.acceptanceInstruction ?? "",
    mcp: mcp
      ? { url: mcp.url, tools: mcp.tools ? [...mcp.tools] : null }
      : null,
    timeoutMinutes,
    resumeSessionId: "resumeSessionId" in input ? input.resumeSessionId : null,
  });
  if (!launch.success) throw new AgentError("plan_local_launch_invalid");
  return launch.data;
}

/** Reads the active launch contract from disk, falling back to the initial manifest launch. */
export async function readCurrentLocalLaunch(
  directory: string,
  entry: LocalSessionEntry,
): Promise<LocalSessionLaunch> {
  try {
    return localLaunchSchema.parse(
      await readLocalRecord(path.join(directory, "current.json")),
    );
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    const owned = await proveLocalOwner(entry, directory);
    return owned.manifest.launch;
  }
}

/** Resolves the stored launch contract for an original shared MCP slot or turn. */
export async function readSharedLocalLaunch(
  directory: string,
  entry: LocalSessionEntry,
  turnId?: string,
): Promise<LocalSessionLaunch> {
  const owned = await proveLocalOwner(entry, directory);
  if (!turnId) return readCurrentLocalLaunch(directory, entry);
  if (owned.manifest.launch.turnId === turnId) return owned.manifest.launch;
  if (!/^[a-f0-9-]{36}$/u.test(turnId))
    throw new AgentError("plan_context_changed");
  return localLaunchSchema.parse(
    await readLocalRecord(path.join(directory, `turn-${turnId}.json`)),
  );
}

/** Reads committed checkpoint mutations used to restore retained native group bookkeeping. */
export async function readLocalSessionMilestones(
  owners: LocalSessionRepository,
  instanceKey: string,
  database: Database,
  instanceId: string,
): Promise<readonly LocalSessionMutation[]> {
  const entry = (await owners.list(instanceKey)).find(
    (candidate) => candidate.instanceId === instanceId,
  );
  if (!entry?.checkpointFile) return [];
  const checkpoint: unknown = JSON.parse(
    await requireAgentFiles(database).read(entry.checkpointFile),
  );
  if (!Array.isArray(checkpoint))
    throw new Error("Invalid local session checkpoint");
  return checkpoint.map((mutation: unknown) =>
    localMutationSchema.parse(mutation),
  );
}
