import { pipeline } from "node:stream/promises";

import { chatAttachmentDownloadHeaders } from "@/app/lib/chat-attachment-headers";
import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_MOBILE_PATH } from "@/definition/PicaMobile";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type {
  PicaMobileAuthenticator,
  PicaMobileClientOrigin,
} from "../PicaMobileAuthenticator";
import type {
  PicaMobileChatFileOutcome,
  PicaMobileChatProvider,
} from "./PicaMobileChatProvider";

/** What the attachment endpoints are built from. */
export interface PicaMobileChatFilesOptions {
  readonly authenticator: PicaMobileAuthenticator;
  readonly chat: PicaMobileChatProvider;
}

/** One request the attachment endpoints answer. */
type ChatFileRequest =
  | {
      readonly kind: "upload";
      readonly sessionId: string | null;
      readonly fileName: string;
    }
  | { readonly kind: "download" | "discard"; readonly attachmentId: string };

const COMPONENT = "PicaMobileChatFiles";
const ATTACHMENTS_PATH = `${PICA_MOBILE_PATH}/chat/attachments`;
const MAXIMUM_TRANSFERS_PER_ACCOUNT = 4;
const MAXIMUM_USER_AGENT_LENGTH = 200;
const BEARER = /^Bearer ([^\s]{1,256})$/u;

/** Status of a failed transfer: missing things 404, a too large file 413, anything else 400. */
const FAILURE_STATUSES: Readonly<Record<string, number>> = {
  sessionMissing: 404,
  attachmentMissing: 404,
  fileTooLarge: 413,
};

/**
 * Reads which attachment endpoint a request addresses.
 *
 * @param request - A plain HTTP request on the port of Pica Mobile.
 * @returns The request, or `null` for every other method and path.
 */
function readChatFileRequest(request: IncomingMessage): ChatFileRequest | null {
  let url: URL;

  try {
    url = new URL(request.url ?? "/", "http://pica-mobile.invalid");
  } catch {
    return null;
  }

  if (url.pathname === ATTACHMENTS_PATH) {
    return request.method === "PUT"
      ? {
          kind: "upload",
          sessionId: url.searchParams.get("session"),
          fileName: url.searchParams.get("name") ?? "",
        }
      : null;
  }

  const attachmentId = url.pathname.slice(ATTACHMENTS_PATH.length + 1);

  if (
    !url.pathname.startsWith(`${ATTACHMENTS_PATH}/`) ||
    attachmentId.length === 0 ||
    attachmentId.includes("/")
  ) {
    return null;
  }

  if (request.method === "GET") {
    return { kind: "download", attachmentId };
  }

  return request.method === "DELETE" ? { kind: "discard", attachmentId } : null;
}

/**
 * Reads the origin of a plain HTTP request on the port of Pica Mobile.
 *
 * @param request - The request.
 * @param clientAddress - The app's address, as the gateway decided it.
 * @returns The address and the shortened user agent the authentication logs.
 */
export function readPicaMobileFileOrigin(
  request: IncomingMessage,
  clientAddress: string | null,
): PicaMobileClientOrigin {
  const userAgent = request.headers["user-agent"];

  return {
    clientAddress,
    userAgent:
      typeof userAgent === "string"
        ? userAgent.slice(0, MAXIMUM_USER_AGENT_LENGTH)
        : null,
  };
}

function readContentLength(request: IncomingMessage): number | null {
  const length = Number(request.headers["content-length"]);

  return Number.isFinite(length) && length > 0 ? length : null;
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

/**
 * Checks the session token a plain HTTP request carries as `Authorization: Bearer`.
 *
 * @param authenticator - Checks the token like an `auth` message.
 * @param request - The request; the token is never read from its address.
 * @param origin - The origin the authentication logs.
 * @returns The account and session, or `null` without a valid token.
 */
export async function authenticatePicaMobileBearer(
  authenticator: Pick<PicaMobileAuthenticator, "authenticate">,
  request: IncomingMessage,
  origin: PicaMobileClientOrigin,
): Promise<PicaMobileSessionIdentity | null> {
  const token = BEARER.exec(request.headers.authorization ?? "")?.[1];

  if (token === undefined) {
    return null;
  }

  const outcome = await authenticator.authenticate(
    { method: "session", token },
    origin,
  );

  return outcome.ok ? { userId: outcome.user.id, sessionToken: token } : null;
}

/**
 * The attachment endpoints of `chat.v1` on the port of Pica Mobile:
 * upload for the next message, download and discarding an unsent file.
 *
 * @remarks
 * A request carries the session token of the app as `Authorization: Bearer`,
 * never in the address; the token is checked like an `auth` message and then
 * like every chat request. One account has at most four transfers at once; a
 * transfer that ends or breaks off frees its place. Tokens and file contents
 * are never logged.
 */
export class PicaMobileChatFiles {
  private readonly options: PicaMobileChatFilesOptions;
  private readonly transfers = new Map<string, number>();

  /**
   * Creates the endpoints.
   *
   * @param options - Authentication and the chat that stores the files.
   */
  public constructor(options: PicaMobileChatFilesOptions) {
    this.options = options;
  }

  /**
   * Answers a request when it addresses an attachment endpoint.
   *
   * @param request - A plain HTTP request on the port of Pica Mobile.
   * @param response - Its answer.
   * @param clientAddress - The app's address; the peer of the request unless
   * `pages-core` relayed it (PAGE-239).
   * @returns Whether the request is one of the endpoints; the caller answers every other one.
   */
  public handle(
    request: IncomingMessage,
    response: ServerResponse,
    clientAddress: string | null = request.socket.remoteAddress ?? null,
  ): boolean {
    const fileRequest = readChatFileRequest(request);

    if (fileRequest === null) {
      return false;
    }

    const origin = readPicaMobileFileOrigin(request, clientAddress);

    void this.serve(request, response, {
      fileRequest,
      origin,
    }).catch((error: unknown) => {
      logCaughtError(COMPONENT, error);

      if (response.headersSent) {
        response.destroy();
      } else {
        respond(response, 500, { ok: false, error: "general" });
      }
    });

    return true;
  }

  private async serve(
    request: IncomingMessage,
    response: ServerResponse,
    target: {
      readonly fileRequest: ChatFileRequest;
      readonly origin: PicaMobileClientOrigin;
    },
  ): Promise<void> {
    const { fileRequest, origin } = target;
    const session = await authenticatePicaMobileBearer(
      this.options.authenticator,
      request,
      origin,
    );

    if (session === null) {
      respond(response, 401, { ok: false, error: "accessDenied" });

      return;
    }

    const count = this.transfers.get(session.userId) ?? 0;

    if (count >= MAXIMUM_TRANSFERS_PER_ACCOUNT) {
      respond(response, 429, { ok: false, error: "tooManyTransfers" });

      return;
    }

    this.transfers.set(session.userId, count + 1);

    try {
      await this.transfer({ request, response, fileRequest, session });
    } finally {
      this.release(session.userId);
    }
  }

  private async transfer(exchange: {
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
    readonly fileRequest: ChatFileRequest;
    readonly session: PicaMobileSessionIdentity;
  }): Promise<void> {
    const { request, response, fileRequest, session } = exchange;
    const { chat } = this.options;
    let outcome: PicaMobileChatFileOutcome;

    if (fileRequest.kind === "upload") {
      outcome = await chat.upload(session, {
        sessionId: fileRequest.sessionId,
        file: {
          fileName: fileRequest.fileName,
          contentLength: readContentLength(request),
          body: request,
        },
      });
    } else if (fileRequest.kind === "download") {
      outcome = await chat.download(session, fileRequest.attachmentId);
    } else {
      outcome = await chat.discard(session, fileRequest.attachmentId);
    }

    await this.answer(response, outcome);
  }

  private async answer(
    response: ServerResponse,
    outcome: PicaMobileChatFileOutcome,
  ): Promise<void> {
    switch (outcome.kind) {
      case "stored":
        respond(response, 200, { ok: true, attachment: outcome.attachment });

        return;
      case "discarded":
        respond(response, 200, { ok: true });

        return;
      case "sessionEnded":
        respond(response, 401, { ok: false, error: "accessDenied" });

        return;
      case "failed":
        respond(response, FAILURE_STATUSES[outcome.code] ?? 400, {
          ok: false,
          error: outcome.code,
        });

        return;
      case "opened":
        response.writeHead(
          200,
          chatAttachmentDownloadHeaders(outcome.attachment),
        );
        // Resolves when the file is out and rejects when the app breaks off; both free the place.
        await pipeline(outcome.stream, response);
    }
  }

  private release(userId: string): void {
    const left = (this.transfers.get(userId) ?? 1) - 1;

    if (left > 0) {
      this.transfers.set(userId, left);
    } else {
      this.transfers.delete(userId);
    }
  }
}
