import { logCaughtError } from "@/backend/logging/Logger";

import type { ContentBlock } from "@agentclientprotocol/sdk";
import type {
  ChatAnswerFileService,
  ChatAnswerRun,
} from "../ChatAnswerFileService";

/** The extensions of images an agent returns as image blocks, by their type. */
const IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

/** The files an agent may return as embedded resources: the types Pages accepts for uploads. */
const RESOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
]);

/** What a job uses of the answer files: storing, linking and removing them. */
export type PicaAnswerFiles = Pick<
  ChatAnswerFileService,
  "stage" | "claim" | "discard"
>;

/** The job the files belong to: its person, conversation and ID. */
interface PicaAnswerJob {
  readonly actor: { readonly id: string };
  readonly sessionId: string;
  readonly id: string;
}

/** A file the agent returned, as Pages stores it. */
interface ReturnedFile {
  readonly fileName: string;
  readonly bytes: Buffer;
  readonly extensions: ReadonlySet<string>;
}

/** The last segment of a resource URI, without query and fragment; never a path Pages opens. */
function resourceName(uri: string, fallback: string): string {
  const path = uri.split(/[?#]/u, 1)[0] ?? "";
  const segment = path.split("/").pop() ?? "";
  try {
    return decodeURIComponent(segment) || fallback;
  } catch (caughtError: unknown) {
    logCaughtError("PicaAcpAnswerOutput", caughtError);
    return fallback;
  }
}

function imageFile(
  block: Extract<ContentBlock, { type: "image" }>,
  number: number,
): ReturnedFile | null {
  const extension = IMAGE_EXTENSIONS.get(block.mimeType);
  // An image that is only a URL is never fetched; it stays what the agent wrote.
  if (extension === undefined || !block.data) return null;
  return {
    fileName: `pica-bild-${number}.${extension}`,
    bytes: Buffer.from(block.data, "base64"),
    extensions: new Set([extension]),
  };
}

function resourceFile(
  block: Extract<ContentBlock, { type: "resource" }>,
  number: number,
): ReturnedFile {
  const { resource } = block;
  const fileName = resourceName(resource.uri, `pica-datei-${number}.txt`);
  const bytes =
    "blob" in resource
      ? Buffer.from(resource.blob, "base64")
      : Buffer.from(resource.text, "utf8");
  return { fileName, bytes, extensions: RESOURCE_EXTENSIONS };
}

/**
 * Takes the images and embedded files an ACP agent returns in its answer and
 * stores them as answer files of the job (PAGE-92).
 *
 * @remarks
 * Only bytes that arrive inside the answer are taken. A `resource_link` or an
 * image given by URL is never fetched, so no remote address and no path of the
 * server becomes a file. Every file passes the checks of an upload; a refused
 * one is logged by its code only.
 */
export class PicaAcpAnswerOutput {
  private readonly files:
    Pick<ChatAnswerFileService, "stage" | "claim" | "discard"> | undefined;
  private readonly run: ChatAnswerRun;
  private readonly pending = new Set<Promise<void>>();
  private count = 0;

  public constructor(files: PicaAnswerFiles | undefined, job: PicaAnswerJob) {
    this.files = files;
    this.run = {
      userId: job.actor.id,
      sessionId: job.sessionId,
      runId: job.id,
    };
  }

  /** Receives a block of the agent's message that is not text. */
  public take(block: ContentBlock): void {
    if (!this.files) return;
    this.count += 1;
    const file = this.read(block);
    if (file === null) return;
    const files = this.files;
    const stored = files
      .stage(this.run, file)
      .then(() => undefined)
      .catch((caughtError: unknown) => {
        logCaughtError("PicaAcpAnswerOutput", caughtError);
      });
    this.pending.add(stored);
    void stored.finally(() => this.pending.delete(stored));
  }

  /** Resolves once every file taken so far is stored or refused. */
  public async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /** Links every file of the job so far, from the tool and from blocks, to a stored answer. */
  public async claim(messageId: string): Promise<void> {
    await this.settle();
    await this.files?.claim(this.run, messageId);
  }

  /** Removes the files of the job that no stored answer holds. */
  public async discard(): Promise<void> {
    await this.settle();
    await this.files?.discard(this.run);
  }

  private read(block: ContentBlock): ReturnedFile | null {
    if (block.type === "image") return imageFile(block, this.count);
    if (block.type === "resource") return resourceFile(block, this.count);
    return null;
  }
}
