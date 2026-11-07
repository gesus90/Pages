import { randomUUID } from "node:crypto";

import { logCaughtError } from "@/backend/logging/Logger";

import type { ChatAttachment } from "@/definition/Chat";
import type { PicaToolOutcome } from "../PicaToolSchemas";
import type { PicaStagedImages } from "./PicaBridge";
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
> &
  Partial<Pick<ChatAnswerFileService, "removeStaged">>;

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
  private readonly files: PicaAnswerFiles | undefined;
  private readonly job: PicaAnswerJob;
  private readonly runs = new Map<number, ChatAnswerRun>();
  private readonly pending = new Map<number, Set<Promise<void>>>();
  private readonly failures = new Map<number, Error>();
  private closedThrough = 0;
  private count = 0;

  public constructor(files: PicaAnswerFiles | undefined, job: PicaAnswerJob) {
    this.files = files;
    this.job = job;
  }

  /** Returns a stable private staging run for the answer turn. */
  public runId(turn: number): string {
    return this.run(turn).runId;
  }

  /** Receives a non-text block associated with the reported answer turn. */
  public take(turn: number, block: ContentBlock): void {
    if (turn <= this.closedThrough) throw new Error("ANSWER_TURN_CLOSED");
    this.count += 1;
    const file = this.read(block);
    if (file === null) {
      if (block.type === "image")
        this.failures.set(turn, new Error("IMAGE_INVALID"));
      return;
    }
    if (!this.files) {
      this.failures.set(turn, new Error("ANSWER_FILES_UNAVAILABLE"));
      return;
    }
    const files = this.files;
    const pending = files.stage(this.run(turn), file).then(
      () => undefined,
      (error: unknown) => {
        logCaughtError("PicaAcpAnswerOutput", error);
        this.failures.set(turn, new Error("ANSWER_FILE_FAILED"));
      },
    );
    let tasks = this.pending.get(turn);
    if (!tasks) {
      tasks = new Set();
      this.pending.set(turn, tasks);
    }
    tasks.add(pending);
    const turnTasks = tasks;
    void pending.finally(() => {
      turnTasks.delete(pending);
      if (turnTasks.size === 0) this.pending.delete(turn);
    });
  }

  /** Stages tool images for one answer and rolls back on refusal or revocation. */
  public async stageImages(
    turn: number,
    images: NonNullable<PicaToolOutcome["images"]>,
    isCurrent: () => boolean,
  ): Promise<PicaStagedImages> {
    if (!this.files?.removeStaged) throw new Error("ANSWER_FILES_UNAVAILABLE");
    const files = this.files;
    const removeStaged = this.files.removeStaged.bind(this.files);
    const run = this.run(turn);
    const staged: ChatAttachment[] = [];
    try {
      for (const image of images) {
        if (!isCurrent()) throw new Error("TURN_INACTIVE");
        this.count += 1;
        const file = imageFile({ type: "image", ...image }, this.count);
        if (!file) throw new Error("IMAGE_INVALID");
        staged.push(await files.stage(run, file));
        if (!isCurrent()) throw new Error("TURN_INACTIVE");
      }
      return {
        attachments: staged,
        rollback: async () => {
          try {
            await removeStaged(
              run,
              staged.map((entry) => entry.id),
            );
          } catch (error: unknown) {
            this.failures.set(turn, new Error("IMAGE_ROLLBACK_FAILED"));
            throw error;
          }
        },
      };
    } catch (error: unknown) {
      try {
        await removeStaged(
          run,
          staged.map((entry) => entry.id),
        );
      } catch (rollbackError: unknown) {
        this.failures.set(turn, new Error("IMAGE_ROLLBACK_FAILED"));
        throw rollbackError;
      }
      throw error;
    }
  }

  /** Resolves after the answer's blocks are stored or reports their refusal. */
  public async settle(turn: number): Promise<void> {
    const tasks = this.pending.get(turn);
    while (tasks && tasks.size > 0) await Promise.allSettled([...tasks]);
    const failure = this.failures.get(turn);
    if (failure) throw failure;
  }

  /** Links only this turn's files before its answer event is sent. */
  public async claim(turn: number, messageId: string): Promise<void> {
    await this.settle(turn);
    const run = this.runs.get(turn);
    if (run) {
      await this.files?.claim(run, messageId);
      await this.files?.discard(run);
    }
    this.closedThrough = Math.max(this.closedThrough, turn);
    this.runs.delete(turn);
    this.pending.delete(turn);
    this.failures.delete(turn);
  }

  /** Removes unclaimed files from every answer turn of this job. */
  public async discard(): Promise<void> {
    for (const [turn, run] of this.runs) {
      const tasks = this.pending.get(turn);
      if (tasks) await Promise.allSettled([...tasks]);
      await this.files?.discard(run);
    }
  }

  private run(turn: number): ChatAnswerRun {
    if (turn <= this.closedThrough) throw new Error("ANSWER_TURN_CLOSED");
    let run = this.runs.get(turn);
    if (!run) {
      run = {
        userId: this.job.actor.id,
        sessionId: this.job.sessionId,
        runId: randomUUID(),
      };
      this.runs.set(turn, run);
    }
    return run;
  }

  private read(block: ContentBlock): ReturnedFile | null {
    if (block.type === "image") return imageFile(block, this.count);
    if (block.type === "resource") return resourceFile(block, this.count);
    return null;
  }
}
