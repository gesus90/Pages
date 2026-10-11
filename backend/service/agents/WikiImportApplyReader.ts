import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { readAgentWikiCreate } from "./AgentWikiCreateValidation";
import { readWikiImportManifest } from "./WikiImportManifestReader";

import type {
  AgentImportApplyInput,
  AgentImportAssetBinding,
} from "@/definition/AgentImportApply";

function record(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST");
  return input as Record<string, unknown>;
}

function assetBinding(input: unknown): AgentImportAssetBinding {
  const fields = record(input);
  if (
    Object.keys(fields).some(
      (key) => !["sourceKey", "assetIds"].includes(key),
    ) ||
    typeof fields.sourceKey !== "string"
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const parsed = readAgentWikiCreate({
    operationId: "validation",
    projectId: "validation",
    parentId: null,
    title: "validation",
    content: "",
    icon: null,
    assetIds: fields.assetIds,
  });
  return { sourceKey: fields.sourceKey, assetIds: [...parsed.assetIds].sort() };
}

/** Validates the confirmed package and asset metadata before any persistence or policy reads. */
export function readWikiImportApply(input: unknown): AgentImportApplyInput {
  const fields = record(input);
  const allowed = [
    "operationId",
    "fingerprint",
    "projectId",
    "parentId",
    "manifest",
    "assets",
  ];
  if (
    Object.keys(fields).some((key) => !allowed.includes(key)) ||
    typeof fields.operationId !== "string" ||
    !fields.operationId.trim() ||
    fields.operationId.length > 200 ||
    typeof fields.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(fields.fingerprint)
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const plan = readWikiImportManifest({
    projectId: fields.projectId,
    parentId: fields.parentId,
    manifest: fields.manifest,
  });
  const entries = fields.assets === undefined ? [] : fields.assets;
  if (!Array.isArray(entries) || entries.length > plan.manifest.files.length)
    throw new AgentOperationError("INVALID_REQUEST");
  const assets = entries
    .map(assetBinding)
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey, "en"));
  if (
    new Set(assets.map((entry) => entry.sourceKey)).size !== assets.length ||
    assets.some(
      (entry) =>
        !plan.manifest.files.some((file) => file.sourceKey === entry.sourceKey),
    )
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const parsed: AgentImportApplyInput = {
    ...plan,
    operationId: fields.operationId,
    fingerprint: fields.fingerprint,
    assets,
  };
  if (
    Buffer.byteLength(
      JSON.stringify({ operation: "wiki.import.apply", parameters: parsed }),
    ) > PAGES_AGENT_LIMITS.requestBytes
  )
    throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
      constraint: "requestBytes",
      limit: PAGES_AGENT_LIMITS.requestBytes,
    });
  return parsed;
}
