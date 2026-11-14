import { createHash } from "node:crypto";
import path from "node:path";

import { localJournalAcknowledgementSchema } from "./LocalSessionContracts";
import { readLocalRecord } from "./LocalSessionFiles";

import type { LocalJournalRecord } from "./LocalSessionContracts";

/** Hashes either representation using the original sequence/previous-digest/body tuple. */
export function localJournalDigest(
  record: Omit<LocalJournalRecord, "digest"> &
    ({ readonly payload: string } | { readonly content: string }),
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        record.sequence,
        record.previousDigest,
        "payload" in record ? record.payload : record.content,
      ]),
    )
    .digest("hex");
}

/** Reads the durable anchor; only a never-acknowledged journal starts at zero. */
export async function readLocalJournalAcknowledgement(
  directory: string,
): Promise<{ readonly sequence: number; readonly digest: string }> {
  try {
    return localJournalAcknowledgementSchema.parse(
      await readLocalRecord(path.join(directory, "ack.json")),
    );
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { sequence: 0, digest: "" };
    throw error;
  }
}
