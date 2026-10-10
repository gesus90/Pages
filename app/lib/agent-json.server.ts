import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

/** Reads at most 64 KiB of UTF-8 JSON, cancelling an oversized stream before parsing it. */
export async function readAgentJson(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AgentOperationError("INVALID_REQUEST");
  if (
    Number(request.headers.get("content-length")) >
    PAGES_AGENT_LIMITS.requestBytes
  )
    throw new AgentOperationError("PAYLOAD_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new AgentOperationError("INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > PAGES_AGENT_LIMITS.requestBytes) {
        await reader.cancel();
        throw new AgentOperationError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AgentOperationError("INVALID_REQUEST");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST");
  return input as Record<string, unknown>;
}
