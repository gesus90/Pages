import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { AGENT_ATTACHMENT_KIND_WORDS } from "@/backend/service/conversation/content/ConversationAttachmentKinds";

import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";
import type {
  AgentAttachmentQuery,
  ConversationAttachmentLibrary,
} from "@/backend/service/conversation/content/ConversationAttachmentLibrary";
import type { AgentReadImage } from "@/backend/service/conversation/content/ConversationDocumentContent";

/** A moment or a day as the agent writes it: ISO 8601. */
const moment = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/u);

/** The kinds the agent may search by, with voice messages. */
const KIND_WORDS = {
  ...AGENT_ATTACHMENT_KIND_WORDS,
  sprachnachricht: "voice",
} as const satisfies Record<string, AgentAttachmentQuery["kind"]>;

const KIND_WORD_LIST = [
  "bild",
  "pdf",
  "dokument",
  "praesentation",
  "tabelle",
  "text",
  "audio",
  "video",
  "datei",
  "sprachnachricht",
] as const satisfies readonly (keyof typeof KIND_WORDS)[];

/** The input of `anhaenge_suchen` (PAGE-386). */
export const AGENT_ATTACHMENT_SEARCH_SCHEMA = z
  .object({
    name: z.string().trim().max(255).optional(),
    art: z.enum(KIND_WORD_LIST).optional(),
    absender: z.string().trim().max(100).optional(),
    von: moment.optional(),
    bis: moment.optional(),
    stichwort: z.string().trim().max(200).optional(),
    anzahl: z.number().int().min(1).max(50).optional(),
  })
  .strict();

/** The input of `anhang_lesen` (PAGE-386). */
export const AGENT_ATTACHMENT_READ_SCHEMA = z
  .object({
    kennung: z
      .string()
      .trim()
      .regex(/^(?:sprachnachricht:)?[a-zA-Z0-9-]{1,100}$/u),
    von: z.number().int().min(1).max(100_000).optional(),
    bis: z.number().int().min(1).max(100_000).optional(),
    blatt: z.string().trim().max(200).optional(),
    zeileAb: z.number().int().min(1).max(10_000_000).optional(),
    bild: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

/** The checked input of `anhaenge_suchen`. */
export type AgentAttachmentSearchInput = z.infer<
  typeof AGENT_ATTACHMENT_SEARCH_SCHEMA
>;

/** The checked input of `anhang_lesen`. */
export type AgentAttachmentReadInput = z.infer<
  typeof AGENT_ATTACHMENT_READ_SCHEMA
>;

/** Which of the two tools is called. */
export type AgentAttachmentAction = "suchen" | "lesen";

/** What the tools of one round know of their agent and its chat. */
export interface AgentAttachmentTurn {
  readonly agentId: string;
  readonly conversationId: string;
  /** Whether the model of the round reads images; `false` only when its catalog says so. */
  readonly canSeeImages: boolean;
}

/** What the tools use. */
export interface AgentAttachmentToolDependencies {
  readonly library: Pick<ConversationAttachmentLibrary, "search" | "read">;
}

/** The tools of one round, bound to the job's working folder. */
export type AgentAttachmentToolRun = (
  action: AgentAttachmentAction,
  directory: string,
  input: unknown,
  signal: AbortSignal,
) => Promise<PicaToolOutcome>;

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function outcome(
  isOk: boolean,
  result: Readonly<Record<string, unknown>>,
  error: string | null,
): PicaToolOutcome {
  return { ok: isOk, result: redactCredentials(JSON.stringify(result)), error };
}

function queryOf(input: AgentAttachmentSearchInput): AgentAttachmentQuery {
  const kind = input.art === undefined ? undefined : KIND_WORDS[input.art];
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(kind === undefined ? {} : { kind }),
    ...(input.absender === undefined ? {} : { sender: input.absender }),
    ...(input.von === undefined ? {} : { since: input.von }),
    ...(input.bis === undefined ? {} : { until: input.bis }),
    ...(input.stichwort === undefined ? {} : { keyword: input.stichwort }),
    ...(input.anzahl === undefined ? {} : { limit: input.anzahl }),
  };
}

/** Writes the images of a reading into the working folder, for the model to open. */
async function writeImages(
  directory: string,
  key: string,
  images: readonly AgentReadImage[],
): Promise<{ readonly datei: string; readonly was: string }[]> {
  if (images.length === 0) return [];
  const folder = path.join(directory, "anhaenge");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const safeKey = key.replace(/[^a-zA-Z0-9-]/gu, "-");
  const files: { datei: string; was: string }[] = [];
  for (const [index, image] of images.entries()) {
    const extension = IMAGE_EXTENSIONS[image.mimeType] ?? "png";
    const file = path.join(
      folder,
      `${safeKey}-${String(index + 1)}.${extension}`,
    );
    await writeFile(file, image.data, { mode: 0o600 });
    files.push({ datei: file, was: image.label });
  }
  return files;
}

async function search(
  dependencies: AgentAttachmentToolDependencies,
  turn: AgentAttachmentTurn,
  input: AgentAttachmentSearchInput,
): Promise<PicaToolOutcome> {
  const found = await dependencies.library.search(
    turn.agentId,
    turn.conversationId,
    queryOf(input),
  );
  return outcome(
    true,
    {
      treffer: found.hits,
      gesamt: found.total,
      hinweis:
        found.total > found.hits.length
          ? `Gezeigt sind ${String(found.hits.length)} von ${String(found.total)} Treffern; grenze die Suche ein oder erhöhe anzahl.`
          : "Lies einen Anhang mit anhang_lesen und seiner Kennung; zeige ihn erneut mit einer Zeile ![Beschreibung](anhang:Kennung).",
    },
    null,
  );
}

async function read(
  dependencies: AgentAttachmentToolDependencies,
  turn: AgentAttachmentTurn,
  run: { readonly directory: string; readonly input: AgentAttachmentReadInput },
): Promise<PicaToolOutcome> {
  const { input } = run;
  const reading = await dependencies.library.read(
    turn.agentId,
    {
      conversationId: turn.conversationId,
      key: input.kennung,
      request: {
        ...(input.von === undefined ? {} : { from: input.von }),
        ...(input.bis === undefined ? {} : { to: input.bis }),
        ...(input.blatt === undefined ? {} : { sheet: input.blatt }),
        ...(input.zeileAb === undefined ? {} : { fromRow: input.zeileAb }),
        ...(input.bild === undefined ? {} : { image: input.bild }),
      },
    },
    turn.canSeeImages,
  );
  const files = await writeImages(run.directory, input.kennung, reading.images);
  return outcome(
    true,
    {
      ...reading.result,
      ...(files.length > 0
        ? {
            bilder: files,
            bildHinweis:
              "Öffne jede genannte Bilddatei mit deinem Werkzeug zum Lesen von Dateien, um sie zu sehen. Hänge sie nicht als Datei an.",
          }
        : {}),
    },
    null,
  );
}

/**
 * `anhaenge_suchen` and `anhang_lesen` of one round in a chat (PAGE-386).
 *
 * @remarks
 * Both stay bound to the chat of the round; the library checks on every call
 * that the agent is still a member, so removal from a group ends the access
 * at once. Images, pictures of documents and stills of videos are written
 * into the job's working folder for the model to open, and only when the
 * model of the round can see images. Credentials in the result are redacted.
 *
 * @param dependencies - The library of the attachments of chats.
 * @param turn - The agent, its chat and whether its model sees images.
 * @returns The tools of the round.
 */
export function agentAttachmentTool(
  dependencies: AgentAttachmentToolDependencies,
  turn: AgentAttachmentTurn,
): AgentAttachmentToolRun {
  return async (action, directory, input, signal) => {
    signal.throwIfAborted();
    try {
      if (action === "suchen")
        return await search(
          dependencies,
          turn,
          AGENT_ATTACHMENT_SEARCH_SCHEMA.parse(input),
        );
      return await read(dependencies, turn, {
        directory,
        input: AGENT_ATTACHMENT_READ_SCHEMA.parse(input),
      });
    } catch (error: unknown) {
      if (error instanceof ConversationError && error.code === "not_found")
        return outcome(
          false,
          {
            meldung:
              "Du bist kein Mitglied dieses Chats (mehr); seine Anhänge kannst du nicht lesen.",
          },
          "ATTACHMENT_ACCESS_DENIED",
        );
      logCaughtError("AgentAttachmentTool", error);
      return outcome(
        false,
        {
          meldung:
            "Der Anhang ließ sich gerade nicht lesen. Sage das der Person, statt den Inhalt zu erraten.",
        },
        "ATTACHMENT_READ_FAILED",
      );
    }
  };
}
