import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { readWikiImportManifest } from "./WikiImportManifestReader";

import type {
  AgentImportUpdateEntry,
  AgentImportUpdateInput,
} from "@/definition/AgentImportUpdate";

function record(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST");
  return input as Record<string, unknown>;
}

function isRevision(input: unknown): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 1;
}

function updateEntry(input: unknown): AgentImportUpdateEntry {
  const fields = record(input);
  if (
    Object.keys(fields).some(
      (key) => !["sourceKey", "expectedRevision", "overwrite"].includes(key),
    ) ||
    typeof fields.sourceKey !== "string" ||
    !isRevision(fields.expectedRevision) ||
    (fields.overwrite !== undefined && typeof fields.overwrite !== "boolean")
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    sourceKey: fields.sourceKey,
    expectedRevision: fields.expectedRevision,
    overwrite: fields.overwrite === true,
  };
}

/**
 * Validates the confirmed package and its per-source revisions before any persistence or policy reads.
 *
 * @remarks
 * Every loaded file needs exactly one update entry, so no source is changed implicitly.
 */
export function readWikiImportUpdate(input: unknown): AgentImportUpdateInput {
  const fields = record(input);
  const allowed = [
    "operationId",
    "fingerprint",
    "projectId",
    "parentId",
    "manifest",
    "updates",
  ];
  if (
    Object.keys(fields).some((key) => !allowed.includes(key)) ||
    typeof fields.operationId !== "string" ||
    !fields.operationId.trim() ||
    fields.operationId.length > 200 ||
    typeof fields.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(fields.fingerprint) ||
    !Array.isArray(fields.updates)
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const plan = readWikiImportManifest({
    projectId: fields.projectId,
    parentId: fields.parentId,
    manifest: fields.manifest,
  });
  const loaded = new Set(plan.manifest.files.map((file) => file.sourceKey));
  const updates = fields.updates
    .slice(0, loaded.size + 1)
    .map(updateEntry)
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey, "en"));
  if (
    updates.length === 0 ||
    updates.length !== loaded.size ||
    updates.some(
      (entry, position) =>
        !loaded.has(entry.sourceKey) ||
        entry.sourceKey === updates[position - 1]?.sourceKey,
    )
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const parsed: AgentImportUpdateInput = {
    ...plan,
    operationId: fields.operationId,
    fingerprint: fields.fingerprint,
    updates,
  };
  if (
    Buffer.byteLength(
      JSON.stringify({ operation: "wiki.import.update", parameters: parsed }),
    ) > PAGES_AGENT_LIMITS.requestBytes
  )
    throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
      constraint: "requestBytes",
      limit: PAGES_AGENT_LIMITS.requestBytes,
    });
  return parsed;
}
