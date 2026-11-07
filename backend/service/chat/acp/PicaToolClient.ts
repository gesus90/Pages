import { setTimeout as delay } from "node:timers/promises";

import { PICA_TOOL_OUTCOME } from "../PicaToolSchemas";
import { readPicaInvocationFile } from "./PicaInvocationFile";

import type { PicaToolOutcome } from "../PicaToolSchemas";

/** Maximum input and response accepted by the tool client. */
const MAXIMUM_BYTES = 1024 * 1024;
const MAXIMUM_NATIVE_RESPONSE_BYTES = 4 * 8_000_000 + MAXIMUM_BYTES;
const PENDING_DELAY_MS = 100;
const REQUEST_DEADLINE_MS = 15_000;

/** Server-owned invocation location; neither value comes from tool arguments. */
export interface PicaToolClientBinding {
  readonly descriptorFile: string;
  readonly expectedUrl: string;
}

function requestBody(text: string): string {
  if (Buffer.byteLength(text, "utf8") > MAXIMUM_BYTES)
    throw new Error("REQUEST_TOO_LARGE");
  const input: unknown = JSON.parse(text);
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error("INVALID_REQUEST");
  const entries = Object.fromEntries(Object.entries(input));
  if (entries.action === "catalog" && Object.keys(entries).length === 1)
    return text;
  if (
    (entries.action === "call" || entries.action === "native_call") &&
    typeof entries.name === "string" &&
    /^[A-Za-z0-9_-]{1,100}$/u.test(entries.name) &&
    Object.keys(entries).every((key) =>
      ["action", "name", "arguments"].includes(key),
    )
  )
    return text;
  throw new Error("INVALID_REQUEST");
}

async function readBounded(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximumBytes) throw new Error("RESPONSE_TOO_LARGE");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
  }
}

/**
 * Executes one Pages-owned catalog or tool request with a server-bound destination.
 *
 * @remarks
 * Only the explicit pending response is retried. Network failures and all other
 * responses are returned or rejected without replaying a potentially executed write.
 */
export async function invokePicaTool(
  binding: PicaToolClientBinding,
  input: string,
  signal: AbortSignal,
): Promise<string> {
  const inputRecord: unknown = JSON.parse(requestBody(input));
  if (
    typeof inputRecord !== "object" ||
    inputRecord === null ||
    Reflect.get(inputRecord, "action") === "native_call"
  )
    throw new Error("INVALID_REQUEST");
  const result = await requestTool(binding, input, signal, MAXIMUM_BYTES);
  const parsed: unknown = JSON.parse(result);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    "images" in parsed
  )
    throw new Error("INVALID_RESPONSE");
  return result;
}

/** Invokes one native tool and returns its validated typed image content. */
export async function invokePicaNativeTool(
  binding: PicaToolClientBinding,
  call: { readonly name: string; readonly arguments: unknown },
  signal: AbortSignal,
): Promise<PicaToolOutcome> {
  const input = JSON.stringify({
    action: "native_call",
    name: call.name,
    arguments: call.arguments,
  });
  const result = await requestTool(
    binding,
    input,
    signal,
    MAXIMUM_NATIVE_RESPONSE_BYTES,
  );
  const parsed: unknown = JSON.parse(result);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("INVALID_RESPONSE");
  const outcome = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== "attachments"),
  );
  return PICA_TOOL_OUTCOME.parse(outcome);
}

async function requestTool(
  binding: PicaToolClientBinding,
  input: string,
  signal: AbortSignal,
  maximumBytes: number,
): Promise<string> {
  const body = requestBody(input);
  const descriptor = readPicaInvocationFile(
    binding.descriptorFile,
    binding.expectedUrl,
  );
  const deadline = AbortSignal.any([
    signal,
    AbortSignal.timeout(REQUEST_DEADLINE_MS),
  ]);
  for (;;) {
    deadline.throwIfAborted();
    const response = await fetch(descriptor.url, {
      method: "POST",
      headers: {
        Authorization: descriptor.authorization,
        "Content-Type": "application/json",
      },
      body,
      redirect: "error",
      signal: deadline,
    });
    const result = await readBounded(response, maximumBytes);
    if (response.status !== 409) {
      if (!response.ok) throw new Error(`TOOL_HTTP_${response.status}`);
      return result;
    }
    const pending: unknown = JSON.parse(result);
    if (
      typeof pending !== "object" ||
      pending === null ||
      !("error" in pending) ||
      pending.error !== "TURN_PENDING"
    )
      throw new Error("TOOL_HTTP_409");
    await delay(PENDING_DELAY_MS, undefined, { signal: deadline });
  }
}
