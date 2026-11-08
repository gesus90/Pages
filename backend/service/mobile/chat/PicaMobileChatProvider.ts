import type { Readable } from "node:stream";

import type { UploadedFile } from "@/backend/service/wiki/WikiAttachmentService";
import type {
  PicaMobileChatAnswer,
  PicaMobileChatAttachment,
  PicaMobileChatRequest,
} from "@/definition/PicaMobileProtocol";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";

/**
 * The answer to a chat request.
 *
 * @remarks
 * `sessionEnded` means the session or the account no longer holds; the
 * connection ends as it does when its regular session check fails.
 * `unavailable` means Pages cannot answer the request on this path, such as a
 * message an API agent answered directly; the app sees `server_unavailable`.
 */
export type PicaMobileChatOutcome =
  | { readonly kind: "answer"; readonly answer: PicaMobileChatAnswer }
  | { readonly kind: "sessionEnded" }
  | { readonly kind: "unavailable" };

/** What a chat request is answered for. */
export interface PicaMobileChatContext {
  readonly session: PicaMobileSessionIdentity;
  /** `http://<Host>` of the handshake; `null` for a missing or invalid host. */
  readonly origin: string | null;
}

/**
 * The answer to an attachment transfer.
 *
 * @remarks
 * `failed` carries a code of the chat, such as `attachmentMissing` or
 * `fileTooLarge`; a foreign and a missing attachment fail alike.
 */
export type PicaMobileChatFileOutcome =
  | { readonly kind: "stored"; readonly attachment: PicaMobileChatAttachment }
  | {
      readonly kind: "opened";
      readonly attachment: PicaMobileChatAttachment;
      readonly stream: Readable;
    }
  | { readonly kind: "discarded" }
  | { readonly kind: "failed"; readonly code: string }
  | { readonly kind: "sessionEnded" };

/** A file sent for the next message of a session. */
export interface PicaMobileChatUpload {
  /** The `session` of the address; checked by the chat. */
  readonly sessionId: string | null;
  readonly file: UploadedFile;
}

/**
 * The business answers of an authenticated Pica Mobile connection for `chat.v1`.
 *
 * @remarks
 * A connection without a provider does not announce `chat.v1`, answers the
 * chat requests as unknown, and the attachment addresses with 426. Every call
 * checks the session first and acts only on own sessions of its account.
 */
export interface PicaMobileChatProvider {
  /**
   * Whether {@link PicaMobileChatProvider.answer} answers `chat_delete`. Only
   * then the connection announces `chat.delete`; otherwise the request is
   * unknown.
   */
  readonly canDelete: boolean;
  /** Answers one chat request; rejects only when Pages cannot decide right now. */
  answer(
    context: PicaMobileChatContext,
    request: PicaMobileChatRequest,
  ): Promise<PicaMobileChatOutcome>;
  /** Stores a file for the next message of an own session. */
  upload(
    session: PicaMobileSessionIdentity,
    upload: PicaMobileChatUpload,
  ): Promise<PicaMobileChatFileOutcome>;
  /** Opens an attachment of an own session for download. */
  download(
    session: PicaMobileSessionIdentity,
    attachmentId: string,
  ): Promise<PicaMobileChatFileOutcome>;
  /** Removes an attachment of an own session that was not sent yet. */
  discard(
    session: PicaMobileSessionIdentity,
    attachmentId: string,
  ): Promise<PicaMobileChatFileOutcome>;
}
