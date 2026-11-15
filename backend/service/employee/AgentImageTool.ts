import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { AgentImageError } from "@/backend/error/AgentImageError";
import { logCaughtError } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import {
  AGENT_IMAGE_ASPECT_RATIOS,
  AGENT_IMAGE_LIMITS,
  AGENT_IMAGE_MIME_TYPES,
} from "@/definition/AgentImageGeneration";

import type { ProviderImage } from "@/backend/agents/providers/ProviderImageClients";
import type { AgentFile } from "@/backend/service/conversation/content/ConversationAgentFiles";
import type { ConversationAgentFiles } from "@/backend/service/conversation/content/ConversationAgentFiles";
import type { ConversationAttachments } from "@/backend/service/conversation/content/ConversationAttachments";
import type { ConversationGeneratedImages } from "@/backend/service/conversation/content/ConversationGeneratedImages";
import type { AgentImageErrorCode } from "@/backend/error/AgentImageError";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";
import type {
  AgentImageCapability,
  AgentImageGeneration,
  AgentImageRequest,
} from "./AgentImageGeneration";

/** The input of `bilder_erzeugen` (PAGE-382). */
export const AGENT_IMAGE_TOOL_SCHEMA = z
  .object({
    beschreibung: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_IMAGE_LIMITS.promptCharacters),
    anzahl: z
      .number()
      .int()
      .min(1)
      .max(AGENT_IMAGE_LIMITS.maximumCount)
      .optional(),
    seitenverhaeltnis: z.enum(AGENT_IMAGE_ASPECT_RATIOS).optional(),
    vorlagen: z
      .array(z.string().trim().min(1).max(4000))
      .max(AGENT_IMAGE_LIMITS.maximumTemplates)
      .optional(),
  })
  .strict();

/** The checked input of `bilder_erzeugen`. */
export type AgentImageToolInput = z.infer<typeof AGENT_IMAGE_TOOL_SCHEMA>;

/** What the tool says to the agent for each failure, in the language of its prompt. */
const FAILURE_TEXTS: Readonly<Record<AgentImageErrorCode, string>> = {
  no_image_output:
    "Dieses Modell kann laut seinem Katalog keine Bilder ausgeben.",
  no_image_interface:
    "Für die Verbindung dieses Modells hat Pages keine Schnittstelle zur Bilderzeugung.",
  no_key:
    "Für die Bildfunktion dieses Modells ist in Pages kein nutzbarer Schlüssel hinterlegt.",
  provider_failed: "Der Anbieter hat die Bilderzeugung abgelehnt.",
  provider_unreachable:
    "Der Anbieter war für die Bilderzeugung nicht erreichbar oder hat zu lange gebraucht.",
  no_images: "Das Modell hat kein Bild geliefert.",
  invalid_template:
    "Eine Vorlage ist kein Bild aus einem freigegebenen Ordner (PNG, JPEG, WebP oder GIF bis 20 MB).",
};

/** What one tool of a round knows of its agent and its chat. */
export interface AgentImageTurn {
  readonly agentId: string;
  readonly conversationId: string;
  readonly employee: AgentImageRequest["employee"];
  readonly assignment: AgentImageRequest["assignment"];
}

/** What the tool uses. */
export interface AgentImageToolDependencies {
  readonly generation: Pick<AgentImageGeneration, "generate" | "capability">;
  readonly attachments: Pick<ConversationAttachments, "stage" | "release">;
  readonly pending: Pick<ConversationGeneratedImages, "add">;
  readonly files: Pick<ConversationAgentFiles, "inspect" | "open">;
  readonly now?: () => Date;
}

/** The tool of one round: generates images into the job's working folder and notes them for the answer. */
export type AgentImageToolRun = (
  directory: string,
  input: AgentImageToolInput,
  signal: AbortSignal,
) => Promise<PicaToolOutcome>;

function outcome(
  isOk: boolean,
  result: Readonly<Record<string, unknown>>,
  error: string | null,
): PicaToolOutcome {
  return {
    ok: isOk,
    result: redactCredentials(JSON.stringify(result)),
    error,
  };
}

/** The answer to a model that cannot output images, with the models that could. */
function unableOutcome(
  capability: Extract<AgentImageCapability, { canGenerate: false }>,
): PicaToolOutcome {
  const others =
    capability.alternatives.length > 0
      ? `Bilder ausgeben können diese für dich freigegebenen Modelle: ${capability.alternatives.join(", ")}. Wechseln lässt sich das Modell für diesen Chat mit /model.`
      : "Keines der für dich freigegebenen Modelle kann Bilder ausgeben.";
  return outcome(
    false,
    {
      meldung: `Mit dem Modell ${capability.modelName} kann ich keine Bilder erzeugen. ${FAILURE_TEXTS[capability.reason]} ${others}`,
      modell: capability.modelName,
      moeglicheModelle: capability.alternatives,
      anweisung:
        "Sage das der Person klar mit diesen Modellen. Erfinde kein Bild, schreibe keine Dateizeile dafür und gib keinen Erfolg vor.",
    },
    "IMAGE_OUTPUT_UNSUPPORTED",
  );
}

function failureOutcome(error: AgentImageError): PicaToolOutcome {
  const detail = error.detail === "" ? "" : ` (${error.detail})`;
  return outcome(
    false,
    {
      meldung: `Die Bilderzeugung ist fehlgeschlagen: ${FAILURE_TEXTS[error.code]}${detail}`,
      anweisung:
        "Gib diese Meldung der Person verständlich weiter. Erfinde kein Bild und gib keinen Erfolg vor.",
    },
    `IMAGE_${error.code.toUpperCase()}`,
  );
}

async function* bytesOf(bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield new Uint8Array(bytes);
}

async function readAll(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function isTemplate(
  checked: Omit<AgentFile, "lineIndex"> | string,
): checked is Omit<AgentFile, "lineIndex"> {
  return (
    typeof checked !== "string" &&
    Object.hasOwn(AGENT_IMAGE_MIME_TYPES, checked.mimeType) &&
    checked.sizeBytes <= AGENT_IMAGE_LIMITS.templateBytes
  );
}

/** The name of a generated image: the moment and its number, with the extension of its type. */
function imageName(moment: Date, index: number, mimeType: string): string {
  const stamp = moment
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\..*$/u, "");
  return `bild-${stamp}-${String(index + 1)}${AGENT_IMAGE_MIME_TYPES[mimeType] ?? ".png"}`;
}

/**
 * Builds `bilder_erzeugen` for one round of an agent in a conversation
 * (PAGE-382).
 *
 * @remarks
 * The tool asks {@link AgentImageGeneration} with the model of the round.
 * A model without image output answers with a clear refusal and the models
 * that could, so the agent says it and never fakes an image. Generated images
 * are written into `bilder/` of the job's working folder, an allowed place
 * of file lines, and stored as attachments without a message; the answer of
 * the agent takes them, so the agent writes no path. A failure comes back as
 * a readable message the agent passes on.
 *
 * @param dependencies - Generation, storage and the rules of file lines.
 * @param turn - The agent, its chat and the model of the round.
 */
export function agentImageTool(
  dependencies: AgentImageToolDependencies,
  turn: AgentImageTurn,
): AgentImageToolRun {
  return async (directory, input, signal) => {
    const capability = await dependencies.generation.capability(turn);
    if (!capability.canGenerate) return unableOutcome(capability);
    try {
      const templates = await readTemplates(dependencies, input.vorlagen ?? []);
      const generated = await dependencies.generation.generate({
        ...turn,
        prompt: input.beschreibung,
        count: input.anzahl ?? 1,
        templates,
        signal,
        ...(input.seitenverhaeltnis
          ? { aspectRatio: input.seitenverhaeltnis }
          : {}),
      });
      return await storeImages(dependencies, { turn, directory, generated });
    } catch (error: unknown) {
      if (error instanceof AgentImageError) return failureOutcome(error);
      throw error;
    }
  };
}

async function readTemplates(
  dependencies: AgentImageToolDependencies,
  paths: readonly string[],
): Promise<ProviderImage[]> {
  const templates: ProviderImage[] = [];
  for (const target of paths) {
    const checked = await dependencies.files.inspect(target);
    if (!isTemplate(checked))
      throw new AgentImageError("invalid_template", target);
    templates.push({
      mimeType: checked.mimeType,
      bytes: await readAll(dependencies.files.open(checked)),
    });
  }
  return templates;
}

async function storeImages(
  dependencies: AgentImageToolDependencies,
  run: {
    readonly turn: AgentImageTurn;
    readonly directory: string;
    readonly generated: Awaited<ReturnType<AgentImageGeneration["generate"]>>;
  },
): Promise<PicaToolOutcome> {
  const { turn, directory, generated } = run;
  const moment = dependencies.now?.() ?? new Date();
  const folder = path.join(directory, "bilder");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const names: string[] = [];
  const paths: string[] = [];
  const attachmentIds: string[] = [];
  for (const [index, image] of generated.images.entries()) {
    const name = imageName(moment, index, image.mimeType);
    const file = path.join(folder, name);
    await writeFile(file, image.bytes, { mode: 0o600 });
    const stored = await dependencies.attachments.stage(
      { conversationId: turn.conversationId, senderId: turn.agentId },
      {
        name,
        mimeType: image.mimeType,
        source: bytesOf(image.bytes),
      },
    );
    names.push(name);
    paths.push(file);
    attachmentIds.push(stored.id);
  }
  const beyond = dependencies.pending.add(
    { agentId: turn.agentId, conversationId: turn.conversationId },
    attachmentIds,
  );
  if (beyond.length > 0)
    await dependencies.attachments
      .release(turn.agentId, beyond)
      .catch((error: unknown) => {
        logCaughtError("AgentImageTool", error);
      });
  return outcome(
    true,
    {
      erzeugt: attachmentIds.length - beyond.length,
      dateien: names,
      pfade: paths,
      modell: generated.modelName,
      ...(generated.text === "" ? {} : { textDesModells: generated.text }),
      ...(beyond.length > 0
        ? {
            hinweis:
              "Eine Nachricht trägt höchstens zehn Anhänge; die übrigen Bilder entfallen.",
          }
        : {}),
      anweisung:
        "Pages hängt diese Bilder deiner Antwort an. Schreibe keine Dateizeile und keinen Pfad dafür; beschreibe kurz, was du erzeugt hast. Als Vorlage für weitere Bilder taugen die Pfade.",
    },
    null,
  );
}
