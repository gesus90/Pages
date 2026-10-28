import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";
import { logCaughtError } from "@/backend/logging/Logger";

/** Reads bounded JSON; wiki and plan edits have larger, separately bounded envelopes. */
export async function readAgentJson(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AgentOperationError("INVALID_REQUEST");
  if (
    Number(request.headers.get("content-length")) >
    PAGES_AGENT_LIMITS.wikiEnvelopeBytes
  )
    throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
      constraint: "requestBytes",
      limit: PAGES_AGENT_LIMITS.wikiEnvelopeBytes,
    });
  const reader = request.body?.getReader();
  if (!reader) throw new AgentOperationError("INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > PAGES_AGENT_LIMITS.wikiEnvelopeBytes) {
        await reader.cancel();
        throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
          constraint: "requestBytes",
          limit: PAGES_AGENT_LIMITS.wikiEnvelopeBytes,
        });
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
  const envelope = parseEnvelope(bytes);
  requireEnvelopeBudget(envelope, length);
  return envelope;
}

function parseEnvelope(bytes: Uint8Array): Readonly<Record<string, unknown>> {
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (caughtError: unknown) {
    logCaughtError("agent_json", caughtError);

    throw new AgentOperationError("INVALID_REQUEST");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST");
  const envelope = input as Record<string, unknown>;
  return envelope;
}

function requireEnvelopeBudget(
  envelope: Readonly<Record<string, unknown>>,
  length: number,
): void {
  const limit = envelopeLimit(envelope.operation);
  if (length > limit)
    throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
      constraint: "requestBytes",
      limit,
    });
}

function envelopeLimit(operation: unknown): number {
  if (operation === "wiki.page.create" || operation === "wiki.page.setContent")
    return PAGES_AGENT_LIMITS.wikiEnvelopeBytes;
  if (
    operation === "plans.create" ||
    operation === "plans.update" ||
    operation === "plans.parameter.create" ||
    operation === "plans.parameter.update"
  )
    return PAGES_AGENT_LIMITS.planWriteEnvelopeBytes;
  return PAGES_AGENT_LIMITS.requestBytes;
}
