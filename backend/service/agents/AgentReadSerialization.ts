import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AGENT_READ_LIMITS } from "@/definition/AgentReadChunks";

/** Serializes a bounded result, stopping large string collections before allocation of the whole JSON. */
export function serializeAgentRead(result: unknown): string {
  let stringBytes = 0;
  const serialized = JSON.stringify(result, (key: string, entry: unknown) => {
    stringBytes += Buffer.byteLength(key);
    if (typeof entry === "string") stringBytes += Buffer.byteLength(entry);
    if (stringBytes > AGENT_READ_LIMITS.totalBytes) throw tooLarge();
    return entry;
  });
  if (serialized === undefined)
    throw new AgentOperationError("INVALID_REQUEST");
  if (Buffer.byteLength(serialized) > AGENT_READ_LIMITS.totalBytes)
    throw tooLarge();
  return serialized;
}

function tooLarge(): AgentOperationError {
  return new AgentOperationError("PAYLOAD_TOO_LARGE", {
    constraint: "readResultBytes",
    limit: AGENT_READ_LIMITS.totalBytes,
  });
}
