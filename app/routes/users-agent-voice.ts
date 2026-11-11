import { z } from "zod";

import {
  authenticatedUserContext,
  requireUserManagement,
} from "@/app/lib/auth.server";
import {
  assessRequestOrigin,
  logOriginRefusal,
  requestEntryContext,
} from "@/app/lib/request-origin.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  AGENT_VOICE_ID_MAXIMUM,
  AGENT_VOICE_SAMPLE_LANGUAGES,
  AGENT_VOICE_SPEED,
  VOICE_PLAYBACK_RATE_HEADER,
} from "@/definition/SpeechSynthesis";

import type { MiddlewareFunction } from "react-router";
import type { SpeechSynthesisPreviewError } from "@/backend/service/speech/SpeechSynthesisPreviewService";
import type { Route } from "./+types/users-agent-voice";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The longest body a sample request may have. */
const MAXIMUM_BODY_CHARACTERS = 1_000;

/**
 * A sample request names voice, speed and language, never a text: the
 * sentence is fixed on the server and names the agent's stored name.
 */
const previewRequestSchema = z
  .object({
    voiceId: z
      .string()
      .trim()
      .max(AGENT_VOICE_ID_MAXIMUM)
      .regex(/^[^\p{Cc}]*$/u)
      .nullable(),
    speedTenths: z
      .number()
      .int()
      .min(AGENT_VOICE_SPEED.minimumTenths)
      .max(AGENT_VOICE_SPEED.maximumTenths),
    language: z.enum(AGENT_VOICE_SAMPLE_LANGUAGES),
  })
  .strict();

const ERROR_STATUS: Readonly<Record<SpeechSynthesisPreviewError, number>> = {
  not_configured: 409,
  provider_failed: 502,
  provider_unreachable: 503,
};

function failure(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: NO_STORE });
}

async function readPreviewRequest(
  request: Request,
): Promise<z.infer<typeof previewRequestSchema> | null> {
  const content = await request.text();
  if (content.length > MAXIMUM_BODY_CHARACTERS) return null;
  try {
    const parsed = previewRequestSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Checks management access before the action runs, as the agent endpoint does. */
export const middleware: MiddlewareFunction[] = [requireUserManagement];

/**
 * Speaks the fixed sample sentence of an agent with a voice and a speed (PAGE-300).
 *
 * @remarks
 * Only a `POST` from the page's own origin is answered, by a person who may
 * change the agent. The body names voice ID, speed and language of the
 * sentence; the text itself is fixed on the server. The answer is the audio
 * (`audio/wav` or `audio/mpeg`); {@link VOICE_PLAYBACK_RATE_HEADER} names
 * the rate the player applies when the model refused the speed. Nothing is
 * stored; equal samples come from the service's 24-hour memory.
 */
export async function action({
  request,
  context,
  params,
}: Route.ActionArgs): Promise<Response> {
  if (request.method !== "POST") return failure("invalidInput", 405);
  const refusal = assessRequestOrigin(
    request,
    context.get(requestEntryContext),
  );
  if (refusal !== null) {
    logOriginRefusal(refusal, "/users-api/agent-voice/:agentId");
    return failure(refusal.code, 403);
  }
  const actor = context.get(authenticatedUserContext);
  if (!actor) return failure("forbidden", 403);
  const input = await readPreviewRequest(request);
  if (input === null) return failure("invalidInput", 400);
  const services = await getApplicationServices();
  try {
    const agentName =
      await services.agentEmployeeAdministration.voiceSampleName(
        actor.id,
        params.agentId,
      );
    const outcome = await services.speechSynthesisPreviewService.preview({
      agentName,
      voiceId: input.voiceId === "" ? null : input.voiceId,
      speedTenths: input.speedTenths,
      language: input.language,
      signal: request.signal,
    });
    if (!outcome.ok) return failure(outcome.code, ERROR_STATUS[outcome.code]);
    const { sample } = outcome;
    return new Response(new Uint8Array(sample.audio), {
      headers: {
        ...NO_STORE,
        "Content-Type": sample.mimeType,
        [VOICE_PLAYBACK_RATE_HEADER]: String(sample.playbackRate),
      },
    });
  } catch (error: unknown) {
    logCaughtError("users_agent_voice", error);
    if (error instanceof AgentEmployeeError)
      return failure(error.code, error.code === "forbidden" ? 403 : 404);
    throw error;
  }
}
