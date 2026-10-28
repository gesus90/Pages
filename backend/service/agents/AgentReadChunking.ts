import { createHash } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AGENT_READ_LIMITS } from "@/definition/AgentReadChunks";

import { createAgentCursor, readAgentCursor } from "./AgentCursor";
import { serializeAgentRead } from "./AgentReadSerialization";

import type { AgentReadChunk } from "@/definition/AgentReadChunks";

interface ReadChunkRequest {
  readonly context: string;
  readonly cursor?: unknown;
  readonly maxBytes?: unknown;
}

/** Returns small results unchanged or a UTF-8-safe chunk with a snapshot-bound continuation. */
export function chunkAgentRead<T>(
  result: T,
  request: ReadChunkRequest,
): T | AgentReadChunk {
  const maximum = readAgentChunkMaximum(request.maxBytes);
  const serialized = serializeAgentRead(result);
  const bytes = Buffer.from(serialized);
  if (
    request.cursor === undefined &&
    request.maxBytes === undefined &&
    Buffer.byteLength(JSON.stringify({ apiVersion: "1", result })) <= maximum
  )
    return result;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const context = JSON.stringify([request.context, maximum, sha256]);
  const after = readAgentCursor({ cursor: request.cursor, context });
  const offset = readOffset(after, bytes);
  let length = Math.min(maximum, bytes.length - offset);
  while (length > 0) {
    while (
      offset + length < bytes.length &&
      (bytes[offset + length] & 0xc0) === 0x80
    )
      length -= 1;
    const next = offset + length;
    const response: AgentReadChunk = {
      chunk: {
        text: bytes.toString("utf8", offset, next),
        offsetBytes: offset,
        byteLength: length,
        totalBytes: bytes.length,
        sha256,
        nextCursor:
          next < bytes.length ? createAgentCursor(context, String(next)) : null,
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

/** Validates the requested UTF-8 response budget for a chunked read. */
export function readAgentChunkMaximum(input: unknown): number {
  const maximum = input === undefined ? AGENT_READ_LIMITS.chunkBytes : input;
  if (
    typeof maximum !== "number" ||
    !Number.isSafeInteger(maximum) ||
    maximum < AGENT_READ_LIMITS.minimumChunkBytes ||
    maximum > AGENT_READ_LIMITS.chunkBytes
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return maximum;
}

function readOffset(after: string | null, bytes: Buffer): number {
  const offset = after === null ? 0 : Number(after);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset >= bytes.length ||
    (bytes[offset] & 0xc0) === 0x80
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return offset;
}
