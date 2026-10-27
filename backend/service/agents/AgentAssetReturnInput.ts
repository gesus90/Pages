import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type { AgentAssetReturn } from "@/definition/AgentAssetTransfer";

/** Validated metadata; no credential or path is accepted from the caller. */
export interface AssetUploadInput {
  readonly fileName: string;
  readonly ticketId?: string;
  readonly pageId?: string;
  readonly request?: AgentAssetReturn;
}

/** Validates destination and optional revision metadata before issuing a capability. */
export function readAssetUploadInput(input: unknown): AssetUploadInput {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST");
  const allowed = [
    "fileName",
    "ticketId",
    "pageId",
    "operationId",
    "sourceAttachmentId",
    "sourceType",
    "expectedDigest",
    "replace",
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new AgentOperationError("INVALID_REQUEST");
  const request: Readonly<Record<string, unknown>> = Object.fromEntries(
    Object.entries(input),
  );
  if (typeof request.fileName !== "string")
    throw new AgentOperationError("INVALID_REQUEST");
  const ticketId = optionalIdentifier(request.ticketId);
  const pageId = optionalIdentifier(request.pageId);
  if (ticketId && pageId) throw new AgentOperationError("INVALID_REQUEST");
  const revision = readAssetReturn(request);
  if (pageId && !revision) throw new AgentOperationError("INVALID_REQUEST");
  return { fileName: request.fileName, ticketId, pageId, request: revision };
}

function optionalIdentifier(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string" || !/^[0-9a-f-]{36}$/iu.test(input))
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}
/** Validates optional provenance and revision selection without accepting caller authority. */
export function readAssetReturn(
  request: Readonly<Record<string, unknown>>,
): AgentAssetReturn | undefined {
  if (
    [
      request.operationId,
      request.sourceAttachmentId,
      request.sourceType,
      request.expectedDigest,
      request.replace,
    ].every((entry) => entry === undefined)
  )
    return undefined;
  if (
    (typeof request.ticketId !== "string" &&
      typeof request.pageId !== "string") ||
    typeof request.operationId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/u.test(request.operationId)
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const source = request.sourceAttachmentId;
  const sourceType = readOriginType(request);
  const digest = request.expectedDigest;
  if (
    (source !== undefined ||
      digest !== undefined ||
      request.replace === true) &&
    !hasValidSource(source, digest)
  )
    throw new AgentOperationError("INVALID_REQUEST");
  if (request.replace !== undefined && typeof request.replace !== "boolean")
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    operationId: request.operationId,
    sourceAttachmentId: typeof source === "string" ? source : undefined,
    sourceType,
    expectedDigest: typeof digest === "string" ? digest : undefined,
    replace: request.replace === true,
  };
}

function hasValidSource(source: unknown, digest: unknown): boolean {
  return (
    typeof source === "string" &&
    /^[a-f0-9-]{36}$/iu.test(source) &&
    typeof digest === "string" &&
    /^[a-f0-9]{64}$/u.test(digest)
  );
}

function readOriginType(
  request: Readonly<Record<string, unknown>>,
): AgentAssetReturn["sourceType"] {
  const sourceType = request.sourceType;
  if (sourceType === undefined) return undefined;
  if (
    request.sourceAttachmentId === undefined ||
    (sourceType !== "ticket" && sourceType !== "wiki" && sourceType !== "agent")
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return sourceType;
}
