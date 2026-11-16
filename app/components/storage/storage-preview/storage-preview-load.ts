import { buildStoragePreviewContent } from "./storage-preview-content";
import { storagePreviewPlanOf } from "./storage-preview-kind";
import {
  requestStoragePreviewBytes,
  requestStoragePreviewEntry,
} from "./storage-preview-request";

import type { DocumentFailure } from "@/app/components/chat-page/content/documents/read-document";
import type { StoragePreviewContent } from "./storage-preview-content";
import type { StoragePreviewPlan } from "./storage-preview-kind";
import type {
  StoragePreviewEntry,
  StoragePreviewFailureReason,
  StoragePreviewRefusal,
} from "./storage-preview-request";

/**
 * What loading one file ended with.
 * - `ready`: the content can be shown.
 * - `unsupported`: the file has no preview, or its export is not offered.
 * - `tooLarge`: the file, or what was read of it, exceeds the limit.
 * - `unreadable`: the file is encrypted, damaged or in an unreadable format.
 * - `failed`: the file could not be read; `entry` is `null` when not even
 *   its metadata could be.
 */
export type StoragePreviewOutcome =
  | {
      readonly kind: "ready";
      readonly entry: StoragePreviewEntry;
      readonly plan: StoragePreviewPlan;
      readonly content: StoragePreviewContent;
    }
  | { readonly kind: "unsupported"; readonly entry: StoragePreviewEntry }
  | {
      readonly kind: "tooLarge";
      readonly entry: StoragePreviewEntry;
      readonly limitBytes: number;
    }
  | {
      readonly kind: "unreadable";
      readonly entry: StoragePreviewEntry;
      readonly reason: DocumentFailure;
    }
  | {
      readonly kind: "failed";
      readonly entry: StoragePreviewEntry | null;
      readonly reason: StoragePreviewFailureReason;
    };

function refusedOutcome(
  refusal: StoragePreviewRefusal,
  entry: StoragePreviewEntry | null,
  limitBytes: number,
): StoragePreviewOutcome {
  if (entry !== null && refusal.reason === "unsupported") {
    return { entry, kind: "unsupported" };
  }

  if (entry !== null && refusal.reason === "tooLarge") {
    return {
      entry,
      kind: "tooLarge",
      limitBytes: refusal.limitBytes ?? limitBytes,
    };
  }

  return {
    entry,
    kind: "failed",
    reason:
      refusal.reason === "forbidden" || refusal.reason === "notFound"
        ? refusal.reason
        : "failed",
  };
}

async function readPreview(
  ref: string,
  signal: AbortSignal,
): Promise<StoragePreviewOutcome> {
  const reply = await requestStoragePreviewEntry(ref, signal);

  if (!reply.ok) return refusedOutcome(reply, null, 0);

  const entry = reply.value;

  if (entry.isFolder || entry.isTrashed) {
    return { entry, kind: "failed", reason: "notFound" };
  }

  const plan = storagePreviewPlanOf(entry);

  if (plan === null) return { entry, kind: "unsupported" };

  // A size Drive names saves the download; a missing or wrong one is caught
  // by the limit on the bytes that arrive.
  if (entry.sizeBytes !== null && entry.sizeBytes > plan.limitBytes) {
    return { entry, kind: "tooLarge", limitBytes: plan.limitBytes };
  }

  const bytes = await requestStoragePreviewBytes(
    { exportFormat: plan.exportFormat, limitBytes: plan.limitBytes, ref },
    signal,
  );

  if (!bytes.ok) return refusedOutcome(bytes, entry, plan.limitBytes);

  const built = await buildStoragePreviewContent(plan, {
    bytes: bytes.value,
    name: entry.name,
  });

  return built.ok
    ? { content: built.content, entry, kind: "ready", plan }
    : { entry, kind: "unreadable", reason: built.reason };
}

/**
 * Loads one file for the preview, fresh from Drive.
 * @param ref - The reference of the file.
 * @param signal - Ends the requests when the preview moves on or closes.
 * @returns How loading ended; never rejects.
 * @remarks
 * Drive decides with the rights of the signed-in account on both requests,
 * the metadata and the bytes, so a withdrawn right or a changed file shows
 * up at the next opening. Nothing is kept between two openings.
 */
export async function loadStoragePreview(
  ref: string,
  signal: AbortSignal,
): Promise<StoragePreviewOutcome> {
  try {
    return await readPreview(ref, signal);
  } catch (error: unknown) {
    if (!signal.aborted) {
      console.warn("The Storage preview could not be loaded.", error);
    }

    return { entry: null, kind: "failed", reason: "failed" };
  }
}

/**
 * Frees what an outcome holds open: the parsed PDF and its worker.
 * @param outcome - The outcome that is no longer shown.
 */
export function releaseStoragePreview(outcome: StoragePreviewOutcome): void {
  if (outcome.kind === "ready" && outcome.content.kind === "pdf") {
    outcome.content.preview.close();
  }
}
