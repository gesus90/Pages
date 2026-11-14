import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { AgentMediaError } from "@/backend/error/AgentMediaError";
import { logCaughtError } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import {
  AGENT_MEDIA_LIMITS,
  AGENT_VIDEO_ASPECT_RATIOS,
  agentMediaMimeTypes,
} from "@/definition/AgentMediaGeneration";

import type { AgentMediaErrorCode } from "@/backend/error/AgentMediaError";
import type { ConversationAttachments } from "@/backend/service/conversation/content/ConversationAttachments";
import type { ConversationGeneratedImages } from "@/backend/service/conversation/content/ConversationGeneratedImages";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";
import type { AgentMediaKind } from "@/definition/AgentMediaGeneration";
import type {
  AgentGeneratedMedia,
  AgentMediaCapability,
  AgentMediaGeneration,
  AgentMediaRequest,
} from "./AgentMediaGeneration";

const PROMPT = z.string().trim().min(1).max(AGENT_MEDIA_LIMITS.promptCharacters);

/** The input of `video_erzeugen` (PAGE-384). */
export const AGENT_VIDEO_TOOL_SCHEMA = z
  .object({
    beschreibung: PROMPT,
    seitenverhaeltnis: z.enum(AGENT_VIDEO_ASPECT_RATIOS).optional(),
    dauer: z
      .number()
      .int()
      .min(AGENT_MEDIA_LIMITS.videoSeconds.minimum)
      .max(AGENT_MEDIA_LIMITS.videoSeconds.maximum)
      .optional(),
  })
  .strict();

/** The input of `audio_erzeugen` (PAGE-384). */
export const AGENT_AUDIO_TOOL_SCHEMA = z
  .object({
    beschreibung: PROMPT,
    stimme: z
      .string()
      .trim()
      .regex(/^[\w-]{1,40}$/u)
      .optional(),
  })
  .strict();

/** The checked input of `video_erzeugen` or `audio_erzeugen`. */
export type AgentMediaToolInput = Partial<
  z.infer<typeof AGENT_VIDEO_TOOL_SCHEMA> & z.infer<typeof AGENT_AUDIO_TOOL_SCHEMA>
> & { readonly beschreibung: string };

/** The word for each kind in the answers to the agent. */
const KIND_WORDS: Readonly<Record<AgentMediaKind, { readonly noun: string; readonly plural: string }>> = {
  video: { noun: "Video", plural: "Videos" },
  audio: { noun: "Sound", plural: "Sounds oder Sprache" },
};

/** What the tool says to the agent for each failure, in the language of its prompt. */
function failureText(code: AgentMediaErrorCode, kind: AgentMediaKind): string {
  const { noun, plural } = KIND_WORDS[kind];
  const texts: Readonly<Record<AgentMediaErrorCode, string>> = {
    no_media_output: `Dieses Modell kann laut seinem Katalog keine ${plural} ausgeben.`,
    no_media_interface: `Für die Verbindung dieses Modells hat Pages keine dokumentierte Schnittstelle, die ${plural} erzeugt.`,
    no_key: `Für diese Funktion des Modells ist in Pages kein nutzbarer Schlüssel hinterlegt.`,
    provider_failed: `Der Anbieter hat die Erzeugung abgelehnt.`,
    provider_unreachable: `Der Anbieter war nicht erreichbar oder hat zu lange gebraucht.`,
    no_media: `Das Modell hat kein ${noun} geliefert.`,
  };
  return texts[code];
}

/** What one tool of a round knows of its agent and its chat. */
export interface AgentMediaTurn {
  readonly agentId: string;
  readonly conversationId: string;
  readonly employee: AgentMediaRequest["employee"];
  readonly assignment: AgentMediaRequest["assignment"];
}

/** What the tool uses. */
export interface AgentMediaToolDependencies {
  readonly generation: Pick<AgentMediaGeneration, "generate" | "capability">;
  readonly attachments: Pick<ConversationAttachments, "stage" | "release">;
  /** The files waiting for the answer; images, videos and sounds share them. */
  readonly pending: Pick<ConversationGeneratedImages, "add">;
  readonly now?: () => Date;
}

/** The tool of one round: generates a video or a sound into the job's working folder and notes it for the answer. */
export type AgentMediaToolRun = (
  kind: AgentMediaKind,
  directory: string,
  input: AgentMediaToolInput,
  signal: AbortSignal,
) => Promise<PicaToolOutcome>;

function outcome(
  isOk: boolean,
  result: Readonly<Record<string, unknown>>,
  error: string | null,
): PicaToolOutcome {
  return { ok: isOk, result: redactCredentials(JSON.stringify(result)), error };
}

/** The answer to a model that cannot output the kind, with the models that could. */
function unableOutcome(
  kind: AgentMediaKind,
  capability: Extract<AgentMediaCapability, { canGenerate: false }>,
): PicaToolOutcome {
  const { plural } = KIND_WORDS[kind];
  const others =
    capability.alternatives.length > 0
      ? `${plural} ausgeben können diese für dich freigegebenen Modelle: ${capability.alternatives.join(", ")}. Wechseln lässt sich das Modell für diesen Chat mit /model.`
      : `Keines der für dich freigegebenen Modelle kann ${plural} ausgeben.`;
  return outcome(
    false,
    {
      meldung: `Mit dem Modell ${capability.modelName} kann ich keine ${plural} erzeugen. ${failureText(capability.reason, kind)} ${others}`,
      modell: capability.modelName,
      moeglicheModelle: capability.alternatives,
      anweisung: `Sage das der Person klar mit diesen Modellen. Erfinde kein ${KIND_WORDS[kind].noun}, schreibe keine Dateizeile dafür und gib keinen Erfolg vor.`,
    },
    `${kind.toUpperCase()}_OUTPUT_UNSUPPORTED`,
  );
}

function failureOutcome(kind: AgentMediaKind, error: AgentMediaError): PicaToolOutcome {
  const detail = error.detail === "" ? "" : ` (${error.detail})`;
  return outcome(
    false,
    {
      meldung: `Die Erzeugung ist fehlgeschlagen: ${failureText(error.code, kind)}${detail}`,
      anweisung: `Gib diese Meldung der Person verständlich weiter. Erfinde kein ${KIND_WORDS[kind].noun} und gib keinen Erfolg vor.`,
    },
    `${kind.toUpperCase()}_${error.code.toUpperCase()}`,
  );
}

async function* bytesOf(bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield new Uint8Array(bytes);
}

/**
 * The name of a generated file: the kind and the moment, with the extension of its type.
 *
 * @param kind - Video or audio.
 * @param moment - When it was generated.
 * @param mimeType - The type the provider delivered.
 */
export function mediaFileName(
  kind: AgentMediaKind,
  moment: Date,
  mimeType: string,
): string {
  const stamp = moment.toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "");
  const extension = agentMediaMimeTypes(kind)[mimeType] ?? (kind === "video" ? ".mp4" : ".wav");
  return `${kind === "video" ? "video" : "sound"}-${stamp}${extension}`;
}

/**
 * Builds `video_erzeugen` and `audio_erzeugen` for one round of an agent in a
 * conversation (PAGE-384).
 *
 * @remarks
 * The tool asks {@link AgentMediaGeneration} with the model of the round. A
 * model without the output answers with a clear refusal and the models that
 * could, so the agent says it and never fakes a file. A generated file is
 * written into `videos/` or `sounds/` of the job's working folder and stored
 * as an attachment without a message, kept 72 hours like every file of an
 * agent; the answer of the agent takes it, so the agent writes no path. A
 * failure comes back as a readable message the agent passes on.
 *
 * @param dependencies - Generation and storage.
 * @param turn - The agent, its chat and the model of the round.
 */
export function agentMediaTool(
  dependencies: AgentMediaToolDependencies,
  turn: AgentMediaTurn,
): AgentMediaToolRun {
  return async (kind, directory, input, signal) => {
    const capability = await dependencies.generation.capability({ ...turn, kind });
    if (!capability.canGenerate) return unableOutcome(kind, capability);
    try {
      const generated = await dependencies.generation.generate({
        ...turn,
        kind,
        prompt: input.beschreibung,
        signal,
        ...(kind === "video" && input.seitenverhaeltnis
          ? { aspectRatio: input.seitenverhaeltnis }
          : {}),
        ...(kind === "video" && input.dauer ? { durationSeconds: input.dauer } : {}),
        ...(kind === "audio" && input.stimme ? { voice: input.stimme } : {}),
      });
      return await storeMedia(dependencies, { turn, kind, directory, generated });
    } catch (error: unknown) {
      if (error instanceof AgentMediaError) return failureOutcome(kind, error);
      throw error;
    }
  };
}

async function storeMedia(
  dependencies: AgentMediaToolDependencies,
  run: {
    readonly turn: AgentMediaTurn;
    readonly kind: AgentMediaKind;
    readonly directory: string;
    readonly generated: AgentGeneratedMedia;
  },
): Promise<PicaToolOutcome> {
  const { turn, kind, directory, generated } = run;
  const moment = dependencies.now?.() ?? new Date();
  const folder = path.join(directory, kind === "video" ? "videos" : "sounds");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const name = mediaFileName(kind, moment, generated.media.mimeType);
  const file = path.join(folder, name);
  await writeFile(file, generated.media.bytes, { mode: 0o600 });
  const stored = await dependencies.attachments.stage(
    { conversationId: turn.conversationId, senderId: turn.agentId },
    { name, mimeType: generated.media.mimeType, source: bytesOf(generated.media.bytes) },
  );
  const beyond = dependencies.pending.add(
    { agentId: turn.agentId, conversationId: turn.conversationId },
    [stored.id],
  );
  if (beyond.length > 0)
    await dependencies.attachments.release(turn.agentId, beyond).catch((error: unknown) => {
      logCaughtError("AgentMediaTool", error);
    });
  const isAttached = beyond.length === 0;
  return outcome(
    isAttached,
    {
      erzeugt: isAttached ? 1 : 0,
      datei: name,
      pfad: file,
      modell: generated.modelName,
      ...(generated.text === "" ? {} : { textDesModells: generated.text }),
      anweisung: isAttached
        ? `Pages hängt dieses ${KIND_WORDS[kind].noun} deiner Antwort an. Schreibe keine Dateizeile und keinen Pfad dafür; beschreibe kurz, was du erzeugt hast.`
        : "Eine Nachricht trägt höchstens zehn Anhänge; diese Datei entfällt. Sage das der Person.",
    },
    isAttached ? null : "ATTACHMENT_LIMIT",
  );
}
