import { useRef, useState } from "react";

import {
  chatApi,
  chatErrorCode,
  uploadChatAttachment,
} from "@/app/lib/chat-client";
import { createRandomUuid } from "@/app/lib/random-uuid";
import { CHAT_LIMITS } from "@/definition/Chat";

import type { Dispatch, SetStateAction } from "react";
import type {
  ChatAttachment,
  ChatMessage,
  ChatSession,
} from "@/definition/Chat";
import type { ChatSessionActivity } from "@/definition/ChatJob";

/** The session the panel shows, with the attachments for the next message. */
export interface ChatView {
  readonly session: ChatSession | null;
  readonly messages: readonly ChatMessage[];
  readonly pending: readonly ChatAttachment[];
  /** Jobs, steers and selection snapshots of a Codex agent (PAGE-68). */
  readonly activity?: ChatSessionActivity;
}

/** A file of the next message that is not stored yet: it uploads, or its upload failed. */
export interface ChatUploadItem {
  /** Identifies the file in the browser; two files may share a name. */
  readonly key: string;
  readonly sessionId: string;
  readonly file: File;
  readonly status: "uploading" | "failed";
  /** The error code of a failed upload. */
  readonly error: string | null;
}

/** Files that were not taken into the selection, and why. */
export interface ChatUploadRejection {
  readonly reason: "limit" | "folder";
  readonly names: readonly string[];
}

/** Attachments of the next message: uploads in flight, adding and removing. */
export interface ChatUploads {
  /** Names of the files that are being uploaded. */
  readonly uploading: readonly string[];
  /** Uploading and failed files of the open session, in the order they were chosen. */
  readonly items: readonly ChatUploadItem[];
  /** Files of the last selection that were not taken, or `null`. */
  readonly rejected: readonly ChatUploadRejection[] | null;
  attach(files: readonly File[], folders?: readonly string[]): Promise<void>;
  retry(key: string): Promise<void>;
  /** Removes a failed file, or cancels a file that uploads. */
  dismiss(key: string): void;
  discard(id: string): Promise<void>;
  clearRejected(): void;
}

interface ChatUploadOptions {
  readonly view: ChatView;
  readonly limitBytes: number | null;
  /** Attachments that belong to a message being sent; they no longer take a place. */
  readonly sendingIds: ReadonlySet<string>;
  readonly setView: Dispatch<SetStateAction<ChatView>>;
  readonly setError: (code: string) => void;
}

/** Failures that sending the same file again cannot fix. */
const FINAL_ERRORS: ReadonlySet<string> = new Set([
  "fileTooLarge",
  "fileEmpty",
  "fileTypeNotAllowed",
  "fileNameTooLong",
  "sessionMissing",
]);

/** Tells whether a failed upload may be tried again. */
export function canRetryChatUpload(item: ChatUploadItem): boolean {
  return item.status === "failed" && !FINAL_ERRORS.has(item.error ?? "");
}

/**
 * Applies a read of a session to the view while that session is open.
 *
 * @param current - The view as the panel shows it now.
 * @param fresh - The session as the server returned it.
 * @returns The fresh session; an attachment that finished uploading after the
 * read began stays selected for the next message, unless the read shows it
 * sent with a message.
 */
export function applyChatSessionRead(
  current: ChatView,
  fresh: ChatView,
): ChatView {
  if (current.session?.id !== fresh.session?.id) return current;
  const known = new Set(
    [
      ...fresh.pending,
      ...fresh.messages.flatMap(({ attachments }) => attachments),
    ].map(({ id }) => id),
  );
  const uploaded = current.pending.filter(({ id }) => !known.has(id));
  return { ...fresh, pending: [...fresh.pending, ...uploaded] };
}

/** One item changed, or removed for `null`. */
function changeItem(
  items: readonly ChatUploadItem[],
  key: string,
  change: Partial<ChatUploadItem> | null,
): readonly ChatUploadItem[] {
  if (change === null) return items.filter((item) => item.key !== key);
  return items.map((item) =>
    item.key === key ? { ...item, ...change } : item,
  );
}

/** A new selection split into the files that take a place and the ones left out. */
function planSelection(input: {
  readonly files: readonly File[];
  readonly folders: readonly string[];
  readonly free: number;
  readonly limitBytes: number | null;
  readonly sessionId: string;
}): {
  readonly added: readonly ChatUploadItem[];
  readonly rejections: readonly ChatUploadRejection[];
} {
  const left = input.files.slice(input.free).map(({ name }) => name);
  const rejections: ChatUploadRejection[] = [
    ...(left.length > 0 ? [{ reason: "limit" as const, names: left }] : []),
    ...(input.folders.length > 0
      ? [{ reason: "folder" as const, names: input.folders }]
      : []),
  ];
  const added = input.files.slice(0, input.free).map((file): ChatUploadItem => {
    const isTooLarge =
      input.limitBytes !== null && file.size > input.limitBytes;
    return {
      key: createRandomUuid(),
      sessionId: input.sessionId,
      file,
      status: isTooLarge ? "failed" : "uploading",
      error: isTooLarge ? "fileTooLarge" : null,
    };
  });
  return { added, rejections };
}

/** Removes a stored file of the next message on the server and from the view. */
async function discardUpload(
  id: string,
  view: Pick<ChatUploadOptions, "setView" | "setError">,
): Promise<void> {
  try {
    await chatApi({ intent: "discard", attachmentId: id });
    view.setView((current) => ({
      ...current,
      pending: current.pending.filter((attachment) => attachment.id !== id),
    }));
  } catch (failure: unknown) {
    view.setError(chatErrorCode(failure));
  }
}

function addPending(
  current: ChatView,
  sessionId: string,
  attachment: ChatAttachment,
): ChatView {
  if (current.session?.id !== sessionId) return current;
  if (current.pending.some(({ id }) => id === attachment.id)) return current;
  return { ...current, pending: [...current.pending, attachment] };
}

/**
 * Uploads the files of the next message, at most ten together (PAGE-92).
 *
 * @remarks
 * A selection from the button or a drop adds to the files already chosen;
 * uploads in flight hold their place, so the limit holds across concurrent
 * selections. Files beyond the limit are named and left out; the selection
 * stays as it was. Each file uploads on its own: a failure keeps the others
 * and can be tried again. The size is checked in the browser first; the
 * server checks size, type and the limit again (T6.12.4).
 */
export function useChatUploads({
  view,
  limitBytes,
  sendingIds,
  setView,
  setError,
}: ChatUploadOptions): ChatUploads {
  const [allItems, setItems] = useState<readonly ChatUploadItem[]>([]);
  const [rejected, setRejected] = useState<
    readonly ChatUploadRejection[] | null
  >(null);
  const controllers = useRef(new Map<string, AbortController>());
  // Places taken right now; set at once, so two selections in the same moment count each other.
  const inFlight = useRef(new Map<string, string>());
  const sessionId = view.session?.id ?? null;
  const items = allItems.filter((item) => item.sessionId === sessionId);

  function update(key: string, change: Partial<ChatUploadItem> | null): void {
    setItems((current) => changeItem(current, key, change));
  }

  async function upload(item: ChatUploadItem): Promise<void> {
    const controller = new AbortController();
    controllers.current.set(item.key, controller);
    inFlight.current.set(item.key, item.sessionId);
    try {
      const attachment = await uploadChatAttachment(
        item.sessionId,
        item.file,
        controller.signal,
      );
      setView((current) => addPending(current, item.sessionId, attachment));
      update(item.key, null);
    } catch (failure: unknown) {
      if (controller.signal.aborted) update(item.key, null);
      else
        update(item.key, { status: "failed", error: chatErrorCode(failure) });
    } finally {
      controllers.current.delete(item.key);
      inFlight.current.delete(item.key);
    }
  }

  function freePlaces(session: ChatSession): number {
    const pending = view.pending.filter(({ id }) => !sendingIds.has(id));
    const uploading = [...inFlight.current.values()].filter(
      (id) => id === session.id,
    ).length;
    return CHAT_LIMITS.attachmentsPerMessage - pending.length - uploading;
  }

  async function attach(
    files: readonly File[],
    folders: readonly string[] = [],
  ): Promise<void> {
    const { session } = view;
    if (session === null) return;
    const plan = planSelection({
      files,
      folders,
      free: Math.max(0, freePlaces(session)),
      limitBytes,
      sessionId: session.id,
    });
    setRejected(plan.rejections.length > 0 ? plan.rejections : null);
    const uploads = plan.added.filter((item) => item.status === "uploading");
    // Places are taken before the first request leaves, so a parallel selection sees them.
    for (const item of uploads) inFlight.current.set(item.key, item.sessionId);
    setItems((current) => [...current, ...plan.added]);
    await Promise.all(uploads.map(upload));
  }

  async function retry(key: string): Promise<void> {
    const item = allItems.find((entry) => entry.key === key);
    if (!item || !canRetryChatUpload(item) || view.session === null) return;
    if (freePlaces(view.session) <= 0) {
      setRejected([{ reason: "limit", names: [item.file.name] }]);
      return;
    }
    const again: ChatUploadItem = { ...item, status: "uploading", error: null };
    inFlight.current.set(key, item.sessionId);
    update(key, again);
    await upload(again);
  }

  function dismiss(key: string): void {
    const controller = controllers.current.get(key);
    if (controller) controller.abort();
    else update(key, null);
  }

  return {
    uploading: items
      .filter((item) => item.status === "uploading")
      .map((item) => item.file.name),
    items,
    rejected,
    attach,
    retry,
    dismiss,
    discard: (id) => discardUpload(id, { setView, setError }),
    clearRejected: () => setRejected(null),
  };
}
