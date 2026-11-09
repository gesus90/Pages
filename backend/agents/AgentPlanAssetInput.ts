import { AgentError } from "@/backend/error/AgentErrors";
import { isPlanAssetKind } from "@/definition/AgentPlanAsset";

import { readAgentObject } from "./AgentPayload";

import type { AgentPlanPosition } from "@/definition/AgentPlan";
import type {
  AgentPlanAsset,
  AgentPlanAssetFile,
} from "@/definition/AgentPlanAsset";

const FILE_KEYS = [
  "assetId",
  "fileName",
  "mediaType",
  "kind",
  "size",
  "digest",
];

function isText(input: unknown, maximum: number): input is string {
  return (
    typeof input === "string" &&
    input.trim().length > 0 &&
    input.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(input)
  );
}

function isSize(input: unknown): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0;
}

/**
 * Parses the file a node or stack entry names (PAGE-268).
 *
 * @remarks
 * Only its shape is checked here; whether the file exists, belongs to the
 * plan's project, may be read and still has this content is checked on save.
 *
 * @throws {AgentError} `plan_asset_invalid` for a missing or malformed field.
 */
export function readPlanAssetFile(input: unknown): AgentPlanAssetFile {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentError("plan_asset_invalid");
  const file = readAgentObject(input);
  const { assetId, fileName, mediaType, kind, size, digest } = file;
  if (
    Object.keys(file).some((key) => !FILE_KEYS.includes(key)) ||
    !isText(assetId, 100) ||
    !isText(fileName, 300) ||
    typeof mediaType !== "string" ||
    !/^[a-z]+\/[a-z0-9.+-]{1,100}$/u.test(mediaType) ||
    !isPlanAssetKind(kind) ||
    !isSize(size) ||
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(digest)
  )
    throw new AgentError("plan_asset_invalid");
  return { assetId: assetId.trim(), fileName, mediaType, kind, size, digest };
}

/** Builds an asset node from its checked name; a node without a file is a draft the plan check names. */
export function readPlanAssetNode(
  base: AgentPlanPosition & { readonly id: string },
  fields: { readonly name: string; readonly file: unknown },
): AgentPlanAsset {
  return {
    ...base,
    type: "asset",
    name: fields.name,
    file:
      fields.file === null || fields.file === undefined
        ? null
        : readPlanAssetFile(fields.file),
  };
}
