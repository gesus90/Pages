import { useState } from "react";

import {
  chatApi,
  chatErrorCode,
  uploadChatAttachment,
} from "@/app/lib/chat-client";
import { CHAT_LIMITS } from "@/definition/Chat";

import type { Dispatch, SetStateAction } from "react";
import type {
  ChatAttachment,
  ChatMessage,
  ChatSession,
} from "@/definition/Chat";

/** The session the panel shows, with the attachments for the next message. */
export interface ChatView {
  readonly session: ChatSession | null;
  readonly messages: readonly ChatMessage[];
  readonly pending: readonly ChatAttachment[];
}

/** Attachments of the next message: uploads in flight, adding and removing. */
export interface ChatUploads {
  /** Names of the files that are being uploaded. */
  readonly uploading: readonly string[];
  attach(files: readonly File[]): Promise<void>;
  discard(id: string): Promise<void>;
}

interface ChatUploadOptions {
  readonly view: ChatView;
  readonly limitBytes: number | null;
  readonly setView: Dispatch<SetStateAction<ChatView>>;
  readonly setError: (code: string) => void;
}

/**
 * Uploads files for the next message one after another.
 *
 * @remarks
 * The size is checked in the browser first so a too large file fails at once;
 * the server checks size and type again from the content (T6.12.4).
 */
export function useChatUploads({
  view,
  limitBytes,
  setView,
  setError,
}: ChatUploadOptions): ChatUploads {
  const [uploading, setUploading] = useState<readonly string[]>([]);

  async function upload(session: ChatSession, file: File): Promise<void> {
    setUploading((current) => [...current, file.name]);
    try {
      const attachment = await uploadChatAttachment(session.id, file);
      setView((current) => ({
        ...current,
        pending: [...current.pending, attachment],
      }));
    } catch (failure: unknown) {
      setError(chatErrorCode(failure));
    } finally {
      setUploading((current) => {
        const index = current.indexOf(file.name);
        return current.filter((_, position) => position !== index);
      });
    }
  }

  async function attach(files: readonly File[]): Promise<void> {
    const { session } = view;
    if (session === null) return;
    let count = view.pending.length + uploading.length;
    for (const file of files) {
      if (count >= CHAT_LIMITS.attachmentsPerMessage) {
        setError("tooManyAttachments");
        return;
      }
      if (limitBytes !== null && file.size > limitBytes) {
        setError("fileTooLarge");
        continue;
      }
      count += 1;
      await upload(session, file);
    }
  }

  async function discard(id: string): Promise<void> {
    try {
      await chatApi({ intent: "discard", attachmentId: id });
      setView((current) => ({
        ...current,
        pending: current.pending.filter((attachment) => attachment.id !== id),
      }));
    } catch (failure: unknown) {
      setError(chatErrorCode(failure));
    }
  }

  return { uploading, attach, discard };
}
