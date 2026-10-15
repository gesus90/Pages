import { isUtf8 } from "node:buffer";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ChatError } from "@/backend/error/ChatErrors";

/**
 * Directory of Pica's protected files, fixed by the location of the server code.
 *
 * @remarks
 * In the source tree it is `backend/service/chat/pica/`; the build copies the
 * files next to the server bundle, to `build/server/pica/`. Neither the
 * configuration, the database nor a request can point it elsewhere, and it is
 * apart from the data directory where uploads are stored.
 */
export const PICA_INSTRUCTION_DIRECTORY = fileURLToPath(
  new URL("./pica/", import.meta.url),
);

/** Largest protected file; a bigger one counts as unreadable. */
const MAXIMUM_FILE_BYTES = 64 * 1024;

/** Pica's identity and rules as one chat turn reads them (PAGE-51). */
export interface PicaInstructions {
  /** `SOUL.md`: identity, tone and style of communication. */
  readonly soul: string;
  /** `AGENTS.md`: tasks, way of working and binding rules. */
  readonly agents: string;
}

type PicaInstructionFile = "SOUL.md" | "AGENTS.md";

type PicaFileDefect = "notARegularFile" | "tooLarge" | "notUtf8" | "empty";

/** A protected file that exists but cannot serve as an instruction. */
class PicaFileDefectError extends Error {
  public readonly defect: PicaFileDefect;

  public constructor(defect: PicaFileDefect) {
    super(defect);
    this.name = "PicaFileDefectError";
    this.defect = defect;
  }
}

function failureReason(error: unknown): string {
  if (error instanceof PicaFileDefectError) return error.defect;
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return error instanceof Error ? error.name : typeof error;
}

async function readProtectedFile(location: string): Promise<string> {
  // Only a regular file is read: a link could lead to another agent's files,
  // and a pipe or a device in its place must not stall the chat.
  const entry = await lstat(location);
  if (!entry.isFile()) throw new PicaFileDefectError("notARegularFile");
  if (entry.size > MAXIMUM_FILE_BYTES)
    throw new PicaFileDefectError("tooLarge");
  const bytes = await readFile(location);
  if (!isUtf8(bytes)) throw new PicaFileDefectError("notUtf8");
  const text = bytes.toString("utf8").trim();
  if (!text) throw new PicaFileDefectError("empty");
  return text;
}

async function readOrReport(file: PicaInstructionFile): Promise<string> {
  const location = path.join(PICA_INSTRUCTION_DIRECTORY, file);
  try {
    return await readProtectedFile(location);
  } catch (error: unknown) {
    const reason = failureReason(error);
    // Path and reason only; the content of the file never reaches the log.
    console.error(
      "[pages] A protected instruction file of Pica cannot be used; the chat does not answer.",
      location,
      reason === "ENOENT" ? "missing" : "unreadable",
      reason,
    );
    throw new ChatError("instructionsUnavailable");
  }
}

/**
 * Reads Pica's protected `SOUL.md` and `AGENTS.md` for one chat turn.
 *
 * @returns Both texts, trimmed.
 * @throws {ChatError} `instructionsUnavailable` when a file is missing or unreadable.
 *
 * @remarks
 * The files are read anew for every message, so they apply in every session
 * and after every compaction. They are read from the fixed directory only, and
 * nothing in Pages writes them. There is no fallback: a missing or unreadable
 * file is logged with its path and reason, and the chat answers with an error
 * instead of with other instructions.
 */
export async function readPicaInstructions(): Promise<PicaInstructions> {
  return {
    soul: await readOrReport("SOUL.md"),
    agents: await readOrReport("AGENTS.md"),
  };
}
