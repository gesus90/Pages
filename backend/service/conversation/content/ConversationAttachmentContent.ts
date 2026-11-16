import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { CHAT_DOCUMENT_BYTES } from "@/definition/ChatPreview";

import {
  readDocumentForAgent,
  AGENT_READ_CHARACTERS,
  AGENT_SEARCH_CHARACTERS,
} from "./ConversationDocumentContent";

import type { Readable } from "node:stream";
import type { ConversationTranscriber } from "../ConversationTranscriber";
import type { AgentAttachmentKind } from "./ConversationAttachmentKinds";
import type {
  AgentAttachmentReading,
  AgentAttachmentReadRequest,
  AgentReadImage,
  DocumentReaders,
} from "./ConversationDocumentContent";
import type { ConversationVideoFrameReader } from "./ConversationVideoFrames";

/** Bytes of an image an agent receives at most. */
export const AGENT_IMAGE_BYTES = 20 * 1024 * 1024;

/** Bytes of a sound or video the speech recognition takes at most. */
export const AGENT_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;

/** Bytes of a text file that are read at most. */
const TEXT_FILE_BYTES = 4 * 1024 * 1024;

/** The sentence an agent says about an image its model cannot see. */
export const AGENT_NO_IMAGE_SIGHT =
  "Dein Modell kann keine Bilder sehen. Sage der Person klar, dass du das Bild nicht sehen kannst, und rate nicht, was darauf ist.";

/** An attachment as the reader opens it. */
export interface AgentAttachmentSource {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly kind: AgentAttachmentKind;
  /** Opens the stored file from its start. */
  readonly open: () => Readable;
  /** The preview image the browser made; `null` without one. */
  readonly preview: {
    readonly open: () => Readable;
    readonly mimeType: string;
  } | null;
  /** The length of a video or sound in seconds, once the browser read it. */
  readonly durationSeconds: number | null;
  /** The recognized text Pages kept already; `null` without one. */
  readonly knownText: string | null;
}

/** What the reader uses. */
export interface ConversationAttachmentContentDependencies extends DocumentReaders {
  /** The speech recognition of voice messages; it reads sounds and the sound tracks of videos. */
  readonly transcriber: Pick<ConversationTranscriber, "transcribe">;
  /** Reads stills of videos; absent falls back to the preview image. */
  readonly frames?: ConversationVideoFrameReader;
}

/** Reads a stream up to a limit; `null` when it holds more. */
export async function readLimited(
  stream: Readable,
  maximumBytes: number,
): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += bytes.length;
      if (size > maximumBytes) return null;
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } finally {
    stream.destroy();
  }
}

function reading(
  result: Readonly<Record<string, unknown>>,
  images: readonly AgentReadImage[] = [],
  searchText: string | null = null,
): AgentAttachmentReading {
  return { result, images, searchText };
}

function tooLarge(limit: number, what: string): AgentAttachmentReading {
  return reading({
    hinweis: `Die Datei ist zu groß, um ${what} (Grenze ${String(Math.round(limit / 1024 / 1024))} MB). Pages kennt nur Name, Art, Größe und Prüfsumme.`,
  });
}

/** Lines of a text file between two numbers, within the character limit. */
function textResult(
  text: string,
  request: AgentAttachmentReadRequest,
  isCut: boolean,
): AgentAttachmentReading {
  const lines = redactCredentials(text).split("\n");
  const from = Math.max(1, request.from ?? 1);
  const to = Math.min(lines.length, request.to ?? lines.length);
  const shown: string[] = [];
  let characters = 0;
  let next: number | null = null;
  for (let number = from; number <= to; number += 1) {
    const line = lines[number - 1] ?? "";
    if (shown.length > 0 && characters + line.length > AGENT_READ_CHARACTERS) {
      next = number;
      break;
    }
    characters += line.length + 1;
    shown.push(line);
  }
  return reading(
    {
      zeilen: lines.length,
      von: from,
      bis: from + shown.length - 1,
      text: Array.from(shown.join("\n"))
        .slice(0, AGENT_READ_CHARACTERS)
        .join(""),
      ...(next === null
        ? {}
        : {
            weiterAb: next,
            hinweis: `Begrenzt auf ${String(AGENT_READ_CHARACTERS)} Zeichen; weiter mit von ${String(next)}.`,
          }),
      ...(isCut
        ? {
            begrenzt: `Nur die ersten ${String(TEXT_FILE_BYTES / 1024 / 1024)} MB der Datei wurden gelesen.`,
          }
        : {}),
    },
    [],
    Array.from(redactCredentials(text))
      .slice(0, AGENT_SEARCH_CHARACTERS)
      .join(""),
  );
}

/**
 * Reads the content of one attachment of a chat for an agent.
 *
 * @remarks
 * Images reach only a model that can see them; text documents arrive by
 * numbered pages or slides, tables as header and rows with their full size,
 * sounds and the sound tracks of videos as recognized text, videos also as
 * stills in even intervals. Binary files and unknown types are never opened.
 * Nothing of a file is run: macros, scripts and embedded programs stay data.
 */
export class ConversationAttachmentContent {
  private readonly dependencies: ConversationAttachmentContentDependencies;

  public constructor(dependencies: ConversationAttachmentContentDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads what a request asks of an attachment.
   *
   * @param source - The attachment and how to open it.
   * @param request - Which part to read.
   * @param canSeeImages - Whether the model of the agent reads images.
   */
  public async read(
    source: AgentAttachmentSource,
    request: AgentAttachmentReadRequest,
    canSeeImages: boolean,
  ): Promise<AgentAttachmentReading> {
    switch (source.kind) {
      case "image":
        return this.image(source, canSeeImages);
      case "audio":
        return this.audio(source);
      case "video":
        return this.video(source, canSeeImages);
      case "text":
        return this.text(source, request);
      case "binary":
        return reading({
          hinweis:
            "Pages öffnet diese Datei nicht: Sie ist eine Binärdatei oder hat ein unbekanntes Format. Bekannt sind nur Name, Art, Größe und Prüfsumme.",
        });
      case "pdf":
      case "word":
      case "slides":
      case "sheet":
        return this.document(source, request, canSeeImages);
    }
  }

  private async image(
    source: AgentAttachmentSource,
    canSeeImages: boolean,
  ): Promise<AgentAttachmentReading> {
    if (!canSeeImages)
      return reading({ hinweis: AGENT_NO_IMAGE_SIGHT, bildSichtbar: false });
    if (source.sizeBytes > AGENT_IMAGE_BYTES)
      return tooLarge(AGENT_IMAGE_BYTES, "das Bild zu zeigen");
    const bytes = await readLimited(source.open(), AGENT_IMAGE_BYTES);
    if (!bytes) return tooLarge(AGENT_IMAGE_BYTES, "das Bild zu zeigen");
    return reading({ bildSichtbar: true }, [
      { label: source.name, mimeType: source.mimeType, data: bytes },
    ]);
  }

  private async text(
    source: AgentAttachmentSource,
    request: AgentAttachmentReadRequest,
  ): Promise<AgentAttachmentReading> {
    const stream = source.open();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(String(chunk));
        chunks.push(bytes);
        size += bytes.length;
        if (size >= TEXT_FILE_BYTES) break;
      }
    } finally {
      stream.destroy();
    }
    const bytes = Buffer.concat(chunks).subarray(0, TEXT_FILE_BYTES);
    return textResult(
      bytes.toString("utf8"),
      request,
      source.sizeBytes > TEXT_FILE_BYTES,
    );
  }

  private async document(
    source: AgentAttachmentSource,
    request: AgentAttachmentReadRequest,
    canSeeImages: boolean,
  ): Promise<AgentAttachmentReading> {
    if (request.image !== undefined && !canSeeImages)
      return reading({ hinweis: AGENT_NO_IMAGE_SIGHT, bildSichtbar: false });
    if (source.sizeBytes > CHAT_DOCUMENT_BYTES)
      return tooLarge(CHAT_DOCUMENT_BYTES, "sie zu lesen");
    const bytes = await readLimited(source.open(), CHAT_DOCUMENT_BYTES);
    if (!bytes) return tooLarge(CHAT_DOCUMENT_BYTES, "sie zu lesen");
    return readDocumentForAgent(
      { name: source.name, kind: source.kind, bytes, request },
      this.dependencies,
    );
  }

  /** The recognized text of a sound or of the sound track of a video; kept text first. */
  private async transcript(
    source: AgentAttachmentSource,
  ): Promise<{ readonly text: string | null; readonly note: string | null }> {
    if (source.knownText !== null)
      return { text: source.knownText, note: null };
    if (source.sizeBytes > AGENT_TRANSCRIPTION_BYTES)
      return {
        text: null,
        note: `Die Datei ist zu groß für die Spracherkennung (Grenze ${String(AGENT_TRANSCRIPTION_BYTES / 1024 / 1024)} MB).`,
      };
    const outcome = await this.dependencies.transcriber.transcribe({
      open: source.open,
      mimeType: source.mimeType,
      sizeBytes: source.sizeBytes,
    });
    if (outcome.ok && outcome.text.trim() !== "")
      return { text: redactCredentials(outcome.text.trim()), note: null };
    return {
      text: null,
      note: "Kein gesprochener Text erkannt: vermutlich Musik ohne Sprache, Geräusche oder Stille, oder die Spracherkennung ist gerade nicht verfügbar.",
    };
  }

  private async audio(
    source: AgentAttachmentSource,
  ): Promise<AgentAttachmentReading> {
    const { text, note } = await this.transcript(source);
    return reading(
      {
        ...(source.durationSeconds === null
          ? {}
          : { laengeSekunden: source.durationSeconds }),
        ...(text === null ? { hinweis: note } : { gesprochenerText: text }),
      },
      [],
      text,
    );
  }

  private async video(
    source: AgentAttachmentSource,
    canSeeImages: boolean,
  ): Promise<AgentAttachmentReading> {
    const { text, note } = await this.transcript(source);
    const stills = canSeeImages ? await this.stills(source) : [];
    return reading(
      {
        ...(source.durationSeconds === null
          ? {}
          : { laengeSekunden: source.durationSeconds }),
        ...(text === null ? { tonspur: note } : { textDerTonspur: text }),
        ...(canSeeImages
          ? { standbilder: stills.map((still) => still.label) }
          : {
              standbilder: [],
              hinweis:
                "Dein Modell kann keine Bilder sehen; du kennst nur den Text der Tonspur. Sage das, statt das Bild zu erraten.",
            }),
      },
      stills,
      text,
    );
  }

  private async stills(
    source: AgentAttachmentSource,
  ): Promise<AgentReadImage[]> {
    const frames = await this.dependencies.frames?.frames(
      source.open,
      source.durationSeconds,
    );
    if (frames && frames.length > 0)
      return frames.map((frame, index) => ({
        label: `Standbild ${String(index + 1)} von ${String(frames.length)}`,
        mimeType: "image/jpeg",
        data: frame,
      }));
    if (!source.preview) return [];
    const preview = await readLimited(source.preview.open(), AGENT_IMAGE_BYTES);
    return preview
      ? [
          {
            label: "Vorschaubild des Videos",
            mimeType: source.preview.mimeType,
            data: preview,
          },
        ]
      : [];
  }
}
