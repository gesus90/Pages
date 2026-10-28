import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { chunkAgentRead } from "./AgentReadChunking";
import { sanitizeArtifactText } from "./AgentPlanOutput";
import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentPlanCheckpoint } from "@/definition/AgentPlanRecovery";
import type { AgentPlanReadResult } from "@/definition/AgentPlanOperations";
import type { AgentPlanService } from "./AgentPlanService";
import type { AgentPlanRecoveryService } from "./recovery/AgentPlanRecoveryService";

interface FilterState {
  isFiltered: boolean;
}

/** Filters text recursively while retaining the checkpoint's stored structural evidence. */
function safeValue(value: unknown, state: FilterState): unknown {
  if (typeof value === "string") {
    const safe = sanitizeArtifactText(value);
    if (safe !== value) state.isFiltered = true;
    return safe;
  }
  if (Array.isArray(value)) return value.map((item) => safeValue(item, state));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, safeValue(item, state)]),
    );
  return value;
}

/** The checkpoint's process and native-session IDs do not authorize client actions. */
function checkpointContent(checkpoint: AgentPlanCheckpoint): {
  readonly content: string;
  readonly isFiltered: boolean;
} {
  const state: FilterState = { isFiltered: false };
  const result = checkpoint.result;
  const output =
    result.output === null ? null : sanitizeArtifactText(result.output);
  if (output !== result.output) state.isFiltered = true;
  const script = result.script;
  const projected = {
    ...checkpoint,
    result: {
      ...result,
      output,
      isOutputReduced: result.isOutputReduced || output !== result.output,
      ...(script
        ? {
            script: {
              attemptId: script.attemptId,
              interpreterProfileId: script.interpreterProfileId,
              directory: script.directory,
              startedAt: script.startedAt,
              endedAt: script.endedAt,
              exitCode: script.exitCode,
              signal: script.signal,
              failure: script.failure,
              closeout: script.closeout,
              stdout: script.stdout,
              stderr: script.stderr,
            },
          }
        : {}),
    },
    session: checkpoint.session
      ? {
          attemptId: checkpoint.session.attemptId,
          capabilities: checkpoint.session.capabilities,
        }
      : null,
  };
  const content = JSON.stringify(safeValue(projected, state));
  if (content === undefined) throw new AgentOperationError("INVALID_REQUEST");
  return { content, isFiltered: state.isFiltered };
}

/** Reads one immutable completion under the same current rights as the recovery page. */
export async function readPlanCheckpoint(
  plans: Pick<AgentPlanService, "run">,
  recovery: Pick<AgentPlanRecoveryService, "checkpoint">,
  userId: string,
  input: unknown,
): Promise<AgentPlanReadResult> {
  const fields = readParameterRecord(input);
  requireParameterKeys(
    fields,
    ["planId", "runId"],
    ["version", "cursor", "maxBytes"],
  );
  const planId = readIdentifier(fields.planId);
  const runId = readIdentifier(fields.runId);
  const version = fields.version;
  if (
    version !== undefined &&
    (typeof version !== "number" ||
      !Number.isSafeInteger(version) ||
      version < 1)
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const run = await plans.run(userId, runId);
  if (run.planId !== planId) throw new AgentOperationError("NOT_FOUND");
  const checkpoint = await recovery.checkpoint(userId, runId, version);
  if (
    checkpoint &&
    (checkpoint.runId !== runId || checkpoint.planId !== planId)
  )
    throw new AgentOperationError("NOT_FOUND");
  return chunkAgentRead(
    {
      checkpoint: checkpoint
        ? { version: checkpoint.version, ...checkpointContent(checkpoint) }
        : null,
    },
    {
      context: JSON.stringify([
        userId,
        "plans.run.checkpoint.read",
        planId,
        runId,
        version ?? null,
      ]),
      cursor: fields.cursor,
      maxBytes: fields.maxBytes,
    },
  );
}
