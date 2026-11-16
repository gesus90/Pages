import { join } from "node:path";

import { pagesRequest } from "./pages.mjs";

/** Reads private, server-pinned input in bounded auxiliary packets. */
export async function runnerInputText(socket, jobId, signal, source = "body") {
  const chunks = [];
  let offset = 0;
  for (;;) {
    signal.throwIfAborted();
    const next = await pagesRequest(socket, jobId, {
      kind: "provider-body",
      offset,
      source,
    });
    const bytes = Buffer.from(next.base64, "base64");
    offset += bytes.length;
    if (offset > 33554432 || (!next.done && !bytes.length))
      throw new Error("Provider body limit");
    chunks.push(bytes);
    if (next.done) return Buffer.concat(chunks).toString("utf8");
  }
}

/** Runs the frozen native provider request; credentials remain in this worker's memory only. */
export async function executeApiRequest(command, folder, jobId, signal) {
  const socket = join(folder, "..", "..", "pages.sock");
  const context = await pagesRequest(socket, jobId, { kind: "turn-context" });
  signal.throwIfAborted();
  const body = command.program.body
    ? JSON.stringify(command.program.body)
    : await runnerInputText(socket, jobId, signal);
  let response;
  try {
    response = await fetch(context.url, {
      method: "POST",
      redirect: "error",
      signal,
      headers: context.headers,
      body,
    });
  } catch {
    signal.throwIfAborted();
    return {
      output: null,
      failureCode: "provider_unreachable",
      exitCode: 1,
      signal: null,
      reason: "exit",
    };
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Provider response missing");
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 1024 * 1024) throw new Error("Provider response limit");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  let payload = null;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    if (response.ok) throw new Error("Invalid provider response");
  }
  signal.throwIfAborted();
  const result = await pagesRequest(socket, jobId, {
    kind: "provider-response",
    status: response.status,
    headers: Object.fromEntries(response.headers),
    payload,
  });
  if (result.failureCode)
    return {
      output: null,
      failureCode: result.failureCode,
      resetAt: result.resetAt,
      exitCode: 1,
      signal: null,
      reason: "exit",
    };
  if (
    typeof result.output !== "string" ||
    Buffer.byteLength(result.output) > command.outputBytes
  )
    return { output: null, exitCode: 1, signal: null, reason: "output_limit" };
  return { output: result.output, exitCode: 0, signal: null, reason: null };
}
