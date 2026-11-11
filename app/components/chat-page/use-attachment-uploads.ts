import { useEffect, useRef, useState } from "react";

import {
  CONVERSATION_ATTACHMENT_MAXIMUM_BYTES,
  CONVERSATION_ATTACHMENT_MAXIMUM_COUNT,
  conversationAttachmentKind,
} from "@/definition/ConversationContent";

import { createThumbnail } from "./content/media-thumbnails";

import type { VirtualChatSelection } from "@/definition/VirtualChat";

/** A file of the message being written, on its way to the server or stored there. */
export interface PendingAttachment {
  readonly localId: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  /** `blob:` URL of a small local preview for images; `null` otherwise. */
  readonly previewUrl: string | null;
  /** Between 0 and 1 while uploading. */
  readonly progress: number;
  readonly state: "uploading" | "ready" | "failed";
  /** Set once ready. */
  readonly attachmentId: string | null;
}

/** Why a file was not attached, as the composer explains it. */
export type AttachmentFailure = "tooLarge" | "tooMany" | "failed";

/** The attachments of the message being written (PAGE-298). */
export interface AttachmentUploads {
  readonly items: readonly PendingAttachment[];
  readonly failure: AttachmentFailure | null;
  /** Whether any upload still runs. */
  readonly isUploading: boolean;
  /** Checks the files and starts their uploads. */
  add(files: readonly File[]): void;
  /** Drops one attachment, here and on the server. */
  remove(localId: string): void;
  /**
   * Hands over the IDs of the ready uploads in their order and empties the
   * list without deleting them on the server.
   */
  take(): string[];
}

/** What the hook holds of one upload besides what the list shows. */
interface UploadEntry {
  readonly localId: string;
  readonly file: File;
  readonly previewUrl: string | null;
  /** The running request; `null` before it starts and after it ended. */
  request: XMLHttpRequest | null;
  /** The ID of the stored file, once the server answered. */
  attachmentId: string | null;
}

/** How an upload ended. */
type UploadResult =
  | { readonly kind: "stored"; readonly attachmentId: string }
  | { readonly kind: "refused"; readonly failure: AttachmentFailure }
  | { readonly kind: "aborted" };

const FILES_ADDRESS = "/chat-page-api/files";
const FALLBACK_MIME_TYPE = "application/octet-stream";

/** The kinds of attachment the chat shows with a preview image. */
const THUMBNAIL_KINDS: readonly string[] = ["image", "video", "pdf"];

function readProperty(body: unknown, name: string): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  return new Map<string, unknown>(Object.entries(body)).get(name);
}

/** Reads the answer of the upload: the stored attachment or why it was refused. */
function readUploadResult(request: XMLHttpRequest): UploadResult {
  const body: unknown = request.response;
  const attachmentId = readProperty(readProperty(body, "attachment"), "id");
  const isStored =
    request.status >= 200 &&
    request.status < 300 &&
    readProperty(body, "ok") === true &&
    typeof attachmentId === "string";
  if (isStored) return { kind: "stored", attachmentId };
  const isTooLarge =
    request.status === 413 || readProperty(body, "error") === "too_large";
  return { kind: "refused", failure: isTooLarge ? "tooLarge" : "failed" };
}

/**
 * Sends the file of an entry as the body of one request, so the browser
 * streams it and reports how far it is.
 */
function upload(
  entry: UploadEntry,
  selection: VirtualChatSelection,
  onProgress: (progress: number) => void,
): Promise<UploadResult> {
  const query = new URLSearchParams({
    kind: selection.kind,
    id: selection.id,
    name: entry.file.name,
  });
  const request = new XMLHttpRequest();
  entry.request = request;
  return new Promise((resolve) => {
    request.open("POST", `${FILES_ADDRESS}?${query.toString()}`);
    request.responseType = "json";
    request.setRequestHeader(
      "Content-Type",
      entry.file.type === "" ? FALLBACK_MIME_TYPE : entry.file.type,
    );
    request.upload.onprogress = (event): void => {
      if (event.lengthComputable && event.total > 0)
        onProgress(event.loaded / event.total);
    };
    request.onload = (): void => resolve(readUploadResult(request));
    request.onerror = (): void =>
      resolve({ kind: "refused", failure: "failed" });
    request.onabort = (): void => resolve({ kind: "aborted" });
    request.send(entry.file);
  });
}

function attachmentAddress(attachmentId: string): string {
  const query = new URLSearchParams({ attachmentId });
  return `${FILES_ADDRESS}?${query.toString()}`;
}

/** Deletes an upload no message was sent with. */
async function deleteUpload(attachmentId: string): Promise<void> {
  try {
    await fetch(attachmentAddress(attachmentId), {
      method: "DELETE",
      keepalive: true,
    });
  } catch (error: unknown) {
    console.warn("The unsent attachment could not be deleted", error);
  }
}

/** Creates the preview image of a stored file and uploads it; a failure leaves the file without one. */
async function storeThumbnail(attachmentId: string, file: File): Promise<void> {
  if (!THUMBNAIL_KINDS.includes(conversationAttachmentKind(file.type))) return;
  try {
    const thumbnail = await createThumbnail(file, file.type);
    if (!thumbnail) return;
    await fetch(attachmentAddress(attachmentId), {
      method: "PUT",
      headers: { "Content-Type": thumbnail.type },
      body: thumbnail,
    });
  } catch (error: unknown) {
    console.warn("The preview image could not be stored", error);
  }
}

/** Ends an upload: aborts the request or deletes the stored file, and frees the preview. */
function discard(entry: UploadEntry): void {
  entry.request?.abort();
  if (entry.attachmentId !== null) void deleteUpload(entry.attachmentId);
  if (entry.previewUrl !== null) URL.revokeObjectURL(entry.previewUrl);
}

function createEntry(file: File): UploadEntry {
  return {
    localId: crypto.randomUUID(),
    file,
    previewUrl: file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : null,
    request: null,
    attachmentId: null,
  };
}

function toPending(entry: UploadEntry): PendingAttachment {
  return {
    localId: entry.localId,
    name: entry.file.name,
    sizeBytes: entry.file.size,
    mimeType: entry.file.type === "" ? FALLBACK_MIME_TYPE : entry.file.type,
    previewUrl: entry.previewUrl,
    progress: 0,
    state: "uploading",
    attachmentId: null,
  };
}

/** The files that may be attached, and why the others may not. */
function chooseFiles(
  files: readonly File[],
  heldCount: number,
): { readonly accepted: File[]; readonly failure: AttachmentFailure | null } {
  const fitting = files.filter(
    (file) => file.size <= CONVERSATION_ATTACHMENT_MAXIMUM_BYTES,
  );
  const free = Math.max(0, CONVERSATION_ATTACHMENT_MAXIMUM_COUNT - heldCount);
  const accepted = fitting.slice(0, free);
  if (accepted.length < fitting.length) return { accepted, failure: "tooMany" };
  return {
    accepted,
    failure: fitting.length < files.length ? "tooLarge" : null,
  };
}

/**
 * Uploads the attachments of the message being written into the opened
 * conversation of a person or a group (PAGE-298).
 *
 * @param selection - The opened conversation; `null` attaches nothing.
 * @returns The attachments with their progress and what changes them.
 *
 * @remarks
 * A file over 512 MB and an eleventh file are refused before anything is
 * sent. Each file goes up as the body of its own request, so the browser
 * streams it. For an image, a video and a PDF the page then creates the
 * preview image and stores it; the attachment counts as ready only after
 * that attempt, so the preview exists when the message is sent. Removing an
 * attachment, opening another conversation and leaving the page abort what
 * still runs and delete what was stored but not sent.
 */
export function useAttachmentUploads(
  selection: VirtualChatSelection | null,
): AttachmentUploads {
  const [items, setItems] = useState<readonly PendingAttachment[]>([]);
  const [failure, setFailure] = useState<AttachmentFailure | null>(null);
  const entries = useRef(new Map<string, UploadEntry>());
  const selectionKind = selection?.kind;
  const selectionId = selection?.id;

  useEffect(() => {
    const held = entries.current;
    return () => {
      held.forEach(discard);
      held.clear();
      setItems([]);
      setFailure(null);
    };
  }, [selectionKind, selectionId]);

  function change(localId: string, changes: Partial<PendingAttachment>): void {
    setItems((current) =>
      current.map((item) =>
        item.localId === localId ? { ...item, ...changes } : item,
      ),
    );
  }

  /** Whether the entry is still part of the message being written. */
  function isHeld(entry: UploadEntry): boolean {
    return entries.current.get(entry.localId) === entry;
  }

  async function run(
    entry: UploadEntry,
    target: VirtualChatSelection,
  ): Promise<void> {
    const result = await upload(entry, target, (progress) =>
      change(entry.localId, { progress }),
    );
    entry.request = null;
    if (!isHeld(entry)) {
      // Removed while the server was already answering: nothing may stay there.
      if (result.kind === "stored") void deleteUpload(result.attachmentId);
      return;
    }
    if (result.kind === "aborted") return;
    if (result.kind === "refused") {
      change(entry.localId, { state: "failed" });
      setFailure(result.failure);
      return;
    }
    entry.attachmentId = result.attachmentId;
    change(entry.localId, { progress: 1 });
    await storeThumbnail(result.attachmentId, entry.file);
    if (!isHeld(entry)) return;
    change(entry.localId, {
      state: "ready",
      attachmentId: result.attachmentId,
    });
  }

  function add(files: readonly File[]): void {
    if (!selection || files.length === 0) return;
    const chosen = chooseFiles(files, entries.current.size);
    setFailure(chosen.failure);
    const added = chosen.accepted.map(createEntry);
    if (added.length === 0) return;
    added.forEach((entry) => entries.current.set(entry.localId, entry));
    setItems((current) => [...current, ...added.map(toPending)]);
    added.forEach((entry) => void run(entry, selection));
  }

  function remove(localId: string): void {
    const entry = entries.current.get(localId);
    if (!entry) return;
    entries.current.delete(localId);
    discard(entry);
    setItems((current) => current.filter((item) => item.localId !== localId));
    setFailure(null);
  }

  function take(): string[] {
    const readyIds = items.flatMap((item) =>
      item.state === "ready" && item.attachmentId !== null
        ? [item.attachmentId]
        : [],
    );
    const held = entries.current;
    held.forEach((entry) => {
      // Sent uploads stay on the server; what is not ready yet is not sent.
      const isSent =
        entry.attachmentId !== null && readyIds.includes(entry.attachmentId);
      if (isSent && entry.previewUrl !== null)
        URL.revokeObjectURL(entry.previewUrl);
      if (!isSent) discard(entry);
    });
    held.clear();
    setItems([]);
    setFailure(null);
    return readyIds;
  }

  return {
    items,
    failure,
    isUploading: items.some((item) => item.state === "uploading"),
    add,
    remove,
    take,
  };
}
