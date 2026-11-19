import { z } from "zod";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  CHAT_NO_STORE,
  chatFailure,
  readChatJson,
  requireChatRequest,
} from "@/app/lib/chat-response.server";
import { requestEntryContext } from "@/app/lib/request-origin.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentCallEvent } from "@/definition/AgentCall";
import type { User } from "@/definition/User";
import type { Route } from "./+types/chat-page-agent-call";

/** The longest WAV body of one utterance: 60 seconds of 16-bit mono at 16 kHz and some headroom. */
const MAXIMUM_AUDIO_BYTES = 2_500_000;

const IDENTIFIER = /^[a-zA-Z0-9-]{1,60}$/u;

const spokenSchema = z.object({
  intent: z.literal("spoken"),
  agentId: z.string().regex(IDENTIFIER),
  callId: z.string().regex(IDENTIFIER),
  turn: z.number().int().min(1),
  spokenCharacters: z.number().int().min(0).max(1_000_000),
});

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  // A proxy in front must not hold the first sentence back.
  "X-Accel-Buffering": "no",
} as const;

/** Reads the recording of a request, at most {@link MAXIMUM_AUDIO_BYTES}. */
async function readAudio(request: Request): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAXIMUM_AUDIO_BYTES)
    throw new ChatError("fileTooLarge");
  const reader = request.body?.getReader();
  if (!reader) throw new ChatError("invalidInput");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (
    let chunk = await reader.read();
    !chunk.done;
    chunk = await reader.read()
  ) {
    bytes += chunk.value.byteLength;
    if (bytes > MAXIMUM_AUDIO_BYTES) {
      await reader.cancel();
      throw new ChatError("fileTooLarge");
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks);
}

/** The stream of events of one turn; closing it ends the turn. */
function turnStream(
  run: (
    emit: (event: AgentCallEvent) => void,
    signal: AbortSignal,
  ) => Promise<void>,
  requestSignal: AbortSignal,
): ReadableStream<Uint8Array> {
  const controller = new AbortController();
  const encoder = new TextEncoder();
  requestSignal.addEventListener("abort", () => controller.abort(), {
    once: true,
  });
  return new ReadableStream<Uint8Array>({
    start(stream) {
      const emit = (event: AgentCallEvent): void => {
        if (controller.signal.aborted) return;
        stream.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      void run(emit, controller.signal)
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          logCaughtError("chat_page_agent_call", error);
          emit({ type: "failed", code: "agent_unavailable" });
        })
        .finally(() => {
          if (!controller.signal.aborted) stream.close();
        });
    },
    cancel() {
      controller.abort();
    },
  });
}

/**
 * Tells what a call with an agent needs:
 * `GET /chat-page-api/agent-call?agentId=…` answers `{ ok: true, readiness }`
 * with the state of speech recognition, speech output and the saved voice.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const agentId = new URL(request.url).searchParams.get("agentId") ?? "";
  if (!IDENTIFIER.test(agentId))
    return chatFailure(new ChatError("invalidInput"));
  try {
    const { agentCallService } = await getApplicationServices();
    return Response.json(
      { ok: true, readiness: await agentCallService.readiness(agentId) },
      { headers: CHAT_NO_STORE },
    );
  } catch (error: unknown) {
    if (error instanceof AgentEmployeeError)
      return chatFailure(new ChatError("sessionMissing"));
    return chatFailure(error);
  }
}

async function handleSpoken(request: Request, person: User): Promise<Response> {
  const parsed = spokenSchema.safeParse(await readChatJson(request));
  if (!parsed.success) throw new ChatError("invalidInput");
  const { agentCallService } = await getApplicationServices();
  await agentCallService.reportSpoken(person, parsed.data);
  return Response.json({ ok: true }, { headers: CHAT_NO_STORE });
}

/**
 * One utterance of a call, or the report of an interrupted answer.
 * @remarks
 * `POST /chat-page-api/agent-call?agentId=…&callId=…&turn=…` with the WAV
 * recording of one utterance answers a stream of lines of JSON
 * ({@link AgentCallEvent}): the recognized text, every sentence of the answer
 * with its audio as soon as it is spoken, and the end. A recording without
 * speech answers `silent` and starts no agent turn. Closing the request
 * interrupts the answer. A `POST` with JSON `{ intent: "spoken", agentId,
 * callId, turn, spokenCharacters }` tells the server how much the person
 * heard of an interrupted answer, so the stored text is marked there.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  try {
    requireChatRequest(request, "POST", context.get(requestEntryContext));
    if (request.headers.get("content-type")?.startsWith("application/json"))
      return await handleSpoken(request, person);
    const url = new URL(request.url);
    const audio = await readAudio(request);
    const { agentCallService } = await getApplicationServices();
    const utterance = {
      agentId: url.searchParams.get("agentId") ?? "",
      callId: url.searchParams.get("callId") ?? "",
      turn: Number(url.searchParams.get("turn")),
      audio,
    };
    return new Response(
      turnStream(
        (emit, signal) =>
          agentCallService.turn(person, { ...utterance, signal }, emit),
        request.signal,
      ),
      { headers: STREAM_HEADERS },
    );
  } catch (error: unknown) {
    return chatFailure(error);
  }
}
