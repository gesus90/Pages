import { pipeline } from "node:stream/promises";

import {
  conversationFileHead,
  readByteRange,
} from "@/app/lib/conversation-file-headers";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  CONVERSATION_ATTACHMENT_MAXIMUM_BYTES,
  CONVERSATION_THUMBNAIL_MAXIMUM_BYTES,
} from "@/definition/ConversationContent";
import { PICA_MOBILE_PATH } from "@/definition/PicaMobile";

import {
  authenticatePicaMobileBearer,
  readPicaMobileFileOrigin,
} from "../chat/PicaMobileChatFiles";
import { readCurrentSessionUser } from "../PicaMobileSessionUser";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthService } from "@/backend/auth/AuthService";
import type { ConversationAttachments } from "@/backend/service/conversation/content/ConversationAttachments";
import type { ConversationErrorCode } from "@/definition/Conversation";
import type { User } from "@/definition/User";
import type { PicaMobileAuthenticator } from "../PicaMobileAuthenticator";

/** The Pages services the attachment endpoints use. */
export interface PicaMobileAttachmentServices {
  readonly authService: Pick<AuthService, "getAuthenticatedUser">;
  readonly conversationAttachments: Pick<
    ConversationAttachments,
    "upload" | "uploadThumbnail" | "discard" | "open"
  >;
}

/** What the attachment endpoints are built from. */
export interface PicaMobileAttachmentFilesOptions {
  readonly authenticator: PicaMobileAuthenticator;
  /** Resolves the services when a request needs them. */
  readonly resolveServices: () => Promise<PicaMobileAttachmentServices>;
}

/** One request the endpoints answer. */
type AttachmentRequest =
  | {
      readonly kind: "download";
      readonly attachmentId: string;
      readonly variant: "original" | "thumbnail";
      readonly isDownload: boolean;
    }
  | {
      readonly kind: "upload";
      readonly conversationId: string;
      readonly name: string;
    }
  | { readonly kind: "thumbnail"; readonly attachmentId: string }
  | { readonly kind: "discard"; readonly attachmentId: string };

const COMPONENT = "PicaMobileAttachmentFiles";
/** The web addresses `/chat/files/…` and `/chat-page-api/files` below the app's path. */
const FILES_PATH = `${PICA_MOBILE_PATH}/chat/files/`;
const UPLOAD_PATH = `${PICA_MOBILE_PATH}/chat-page-api/files`;
const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;
const MAXIMUM_TRANSFERS_PER_ACCOUNT = 4;
const OPEN_END = Number.MAX_SAFE_INTEGER;

const STATUS: Readonly<Record<ConversationErrorCode, number>> = {
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  too_large: 413,
  too_long: 400,
  unsupported_format: 415,
};

function readDownload(
  request: IncomingMessage,
  url: URL,
): AttachmentRequest | null {
  if (request.method !== "GET" || !url.pathname.startsWith(FILES_PATH))
    return null;
  const [attachmentId = "", part, ...rest] = url.pathname
    .slice(FILES_PATH.length)
    .split("/");
  const isThumbnail = part === "thumbnail";
  if (
    !IDENTIFIER.test(attachmentId) ||
    rest.length > 0 ||
    (part !== undefined && !isThumbnail)
  )
    return null;
  return {
    kind: "download",
    attachmentId,
    variant: isThumbnail ? "thumbnail" : "original",
    isDownload: url.searchParams.get("download") === "1",
  };
}

/** Reads which attachment endpoint a request addresses; `null` for every other request. */
function readAttachmentRequest(
  request: IncomingMessage,
): AttachmentRequest | null {
  let url: URL;
  try {
    url = new URL(request.url ?? "/", "http://pica-mobile.invalid");
  } catch {
    return null;
  }
  if (url.pathname !== UPLOAD_PATH) return readDownload(request, url);
  const attachmentId = url.searchParams.get("attachmentId") ?? "";
  if (request.method === "POST")
    return {
      kind: "upload",
      conversationId: url.searchParams.get("conversationId") ?? "",
      name: url.searchParams.get("name") ?? "",
    };
  if (request.method === "PUT") return { kind: "thumbnail", attachmentId };
  return request.method === "DELETE" ? { kind: "discard", attachmentId } : null;
}

function respond(
  response: ServerResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void {
  const content = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    // A refused upload is not read to its end; the connection ends with the answer.
    Connection: "close",
    "Content-Length": Buffer.byteLength(content),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(content);
}

function isTooLarge(request: IncomingMessage, maximumBytes: number): boolean {
  const length = Number(request.headers["content-length"]);
  return Number.isFinite(length) && length > maximumBytes;
}

/**
 * The attachment endpoints of `conversations.v1` on the port of Pica Mobile
 * (PAGE-298): the addresses of the web below the app's path.
 *
 * - `GET /pica-mobile/chat/files/<id>` and `…/thumbnail` load the original
 *   and the preview image, as `url` and `thumbnailUrl` of an attachment name
 *   them; `Range` answers a part with 206.
 * - `POST /pica-mobile/chat-page-api/files?conversationId=…&name=…`,
 *   `PUT …?attachmentId=…` and `DELETE …?attachmentId=…` are the upload
 *   interface of the web.
 *
 * @remarks
 * A request carries the session token of the app as `Authorization: Bearer`,
 * as its other file requests do. Membership of the conversation is checked on
 * every request with the services of the web; a file of a conversation the
 * account does not belong to answers 404, as a missing one does. One account
 * has at most four transfers at once.
 */
export class PicaMobileAttachmentFiles {
  private readonly options: PicaMobileAttachmentFilesOptions;
  private readonly transfers = new Map<string, number>();

  /**
   * Creates the endpoints.
   *
   * @param options - Authentication and the services that hold the files.
   */
  public constructor(options: PicaMobileAttachmentFilesOptions) {
    this.options = options;
  }

  /**
   * Answers a request when it addresses an attachment endpoint.
   *
   * @param request - A plain HTTP request on the port of Pica Mobile.
   * @param response - Its answer.
   * @param clientAddress - The app's address, as the gateway decided it.
   * @returns Whether the request is one of the endpoints; the caller answers every other one.
   */
  public handle(
    request: IncomingMessage,
    response: ServerResponse,
    clientAddress: string | null,
  ): boolean {
    const target = readAttachmentRequest(request);
    if (target === null) return false;
    void this.serve({ request, response, clientAddress, target }).catch(
      (error: unknown) => {
        logCaughtError(COMPONENT, error);
        if (response.headersSent) response.destroy();
        else respond(response, 500, { ok: false, error: "general" });
      },
    );
    return true;
  }

  private async serve(exchange: {
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
    readonly clientAddress: string | null;
    readonly target: AttachmentRequest;
  }): Promise<void> {
    const { request, response } = exchange;
    const session = await authenticatePicaMobileBearer(
      this.options.authenticator,
      request,
      readPicaMobileFileOrigin(request, exchange.clientAddress),
    );
    const services = await this.options.resolveServices();
    const user =
      session === null
        ? null
        : await readCurrentSessionUser(services.authService, session);
    if (user === null) {
      respond(response, 401, { ok: false, error: "accessDenied" });
      return;
    }
    const count = this.transfers.get(user.id) ?? 0;
    if (count >= MAXIMUM_TRANSFERS_PER_ACCOUNT) {
      respond(response, 429, { ok: false, error: "tooManyTransfers" });
      return;
    }
    this.transfers.set(user.id, count + 1);
    try {
      await this.transfer(services, user, exchange);
    } catch (error: unknown) {
      if (!(error instanceof ConversationError) || response.headersSent)
        throw error;
      respond(response, STATUS[error.code], { ok: false, error: error.code });
    } finally {
      const left = (this.transfers.get(user.id) ?? 1) - 1;
      if (left > 0) this.transfers.set(user.id, left);
      else this.transfers.delete(user.id);
    }
  }

  private async transfer(
    services: PicaMobileAttachmentServices,
    user: User,
    exchange: {
      readonly request: IncomingMessage;
      readonly response: ServerResponse;
      readonly target: AttachmentRequest;
    },
  ): Promise<void> {
    const { request, response, target } = exchange;
    const { conversationAttachments: attachments } = services;
    const mimeType = request.headers["content-type"] ?? "";
    if (target.kind === "download") {
      const opened = await attachments.open(user, {
        attachmentId: target.attachmentId,
        variant: target.variant,
        range: readByteRange(request.headers.range, OPEN_END),
      });
      const head = conversationFileHead(opened, target.isDownload);
      response.writeHead(head.status, head.headers);
      // Resolves when the file is out and rejects when the app breaks off.
      await pipeline(opened.stream, response);
      return;
    }
    if (target.kind === "discard") {
      await attachments.discard(user, target.attachmentId);
      respond(response, 200, { ok: true, attachment: null });
      return;
    }
    const isThumbnail = target.kind === "thumbnail";
    const limit = isThumbnail
      ? CONVERSATION_THUMBNAIL_MAXIMUM_BYTES
      : CONVERSATION_ATTACHMENT_MAXIMUM_BYTES;
    if (isTooLarge(request, limit)) throw new ConversationError("too_large");
    const source: AsyncIterable<Uint8Array> = request;
    if (target.kind === "thumbnail") {
      const attachment = await attachments.uploadThumbnail(
        user,
        { attachmentId: target.attachmentId, mimeType },
        source,
      );
      respond(response, 200, { ok: true, attachment });
      return;
    }
    const { conversationId, name } = target;
    const attachment = await attachments.upload(
      user,
      { conversationId, name, mimeType },
      source,
    );
    respond(response, 200, { ok: true, attachment });
  }
}
