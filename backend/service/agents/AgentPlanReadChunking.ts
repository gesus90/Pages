import { createHash } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { createAgentCursor, readAgentCursor } from "./AgentCursor";
import { planReadJson } from "./AgentPlanReadJson";
import { readAgentChunkMaximum } from "./AgentReadChunking";

import type { AgentPlanRead } from "@/definition/AgentPlanOperations";
import type { AgentReadChunk } from "@/definition/AgentReadChunks";

interface PlanChunkRequest {
  readonly context: string;
  readonly cursor?: unknown;
  readonly maxBytes?: unknown;
}

interface PlanChunkWindow {
  readonly offset: number;
  readonly maximum: number;
  readonly identity: ReturnType<typeof fingerprint>;
  readonly context: string;
}

function fingerprint(result: AgentPlanRead): {
  readonly sha256: string;
  readonly totalBytes: number;
} {
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const part of planReadJson(result)) {
    const bytes = Buffer.from(part);
    hash.update(bytes);
    totalBytes += bytes.length;
  }
  return { sha256: hash.digest("hex"), totalBytes };
}

function readOffset(cursor: unknown, context: string, total: number): number {
  const after = readAgentCursor({ cursor, context });
  const offset = after === null ? 0 : Number(after);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= total)
    throw new AgentOperationError("INVALID_REQUEST");
  return offset;
}

function readWindow(
  result: AgentPlanRead,
  offset: number,
  maximum: number,
): Buffer {
  const selected: Buffer[] = [];
  const end = offset + maximum + 1;
  let position = 0;
  for (const part of planReadJson(result)) {
    const bytes = Buffer.from(part);
    const next = position + bytes.length;
    if (next > offset && position < end)
      selected.push(
        bytes.subarray(Math.max(0, offset - position), end - position),
      );
    position = next;
    if (position >= end) break;
  }
  return Buffer.concat(selected);
}

function buildChunk(window: Buffer, request: PlanChunkWindow): AgentReadChunk {
  const { offset, maximum, identity, context } = request;
  if ((window[0] & 0xc0) === 0x80)
    throw new AgentOperationError("INVALID_REQUEST");
  let length = Math.min(maximum, identity.totalBytes - offset);
  while (length > 0) {
    while (
      offset + length < identity.totalBytes &&
      (window[length] & 0xc0) === 0x80
    )
      length -= 1;
    const next = offset + length;
    const response: AgentReadChunk = {
      chunk: {
        text: window.toString("utf8", 0, length),
        offsetBytes: offset,
        byteLength: length,
        totalBytes: identity.totalBytes,
        sha256: identity.sha256,
        nextCursor:
          next < identity.totalBytes
            ? createAgentCursor(context, String(next))
            : null,
      },
    };
    if (
      Buffer.byteLength(
        JSON.stringify({ apiVersion: "1", result: response }),
      ) <= maximum
    )
      return response;
    length = Math.floor(length / 2);
  }
  throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
    constraint: "readChunkBytes",
    limit: maximum,
  });
}

/** Streams a complete plan as bounded chunks bound to the exact authorized snapshot. */
export function chunkPlanRead(
  result: AgentPlanRead,
  request: PlanChunkRequest,
): AgentPlanRead | AgentReadChunk {
  const maximum = readAgentChunkMaximum(request.maxBytes);
  const identity = fingerprint(result);
  if (
    request.cursor === undefined &&
    request.maxBytes === undefined &&
    identity.totalBytes <= maximum &&
    Buffer.byteLength(JSON.stringify({ apiVersion: "1", result })) <= maximum
  )
    return result;
  const context = JSON.stringify([request.context, maximum, identity.sha256]);
  const offset = readOffset(request.cursor, context, identity.totalBytes);
  return buildChunk(readWindow(result, offset, maximum), {
    offset,
    maximum,
    identity,
    context,
  });
}
