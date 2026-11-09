import { pipeline } from "node:stream/promises";

import { conversationVoiceHeaders } from "@/app/lib/conversation-voice-headers";
import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_MOBILE_PATH } from "@/definition/PicaMobile";

import {
  authenticatePicaMobileBearer,
  readPicaMobileFileOrigin,
} from "../chat/PicaMobileChatFiles";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { PicaMobileAuthenticator } from "../PicaMobileAuthenticator";
import type { PicaMobileConversationsProvider } from "./PicaMobileConversationsProvider";

/** What the voice endpoint is built from. */
export interface PicaMobileConversationFilesOptions {
  readonly authenticator: PicaMobileAuthenticator;
  readonly conversations: PicaMobileConversationsProvider;
}

const COMPONENT = "PicaMobileConversationFiles";
/** `GET <path>/<messageId>` loads the audio of a voice message. */
const VOICE_PATH = `${PICA_MOBILE_PATH}/conversations/voice`;
const MAXIMUM_TRANSFERS_PER_ACCOUNT = 4;

/** Reads the message a voice request addresses; `null` for every other request. */
function readVoiceMessageId(request: IncomingMessage): string | null {
  let url: URL;

  try {
    url = new URL(request.url ?? "/", "http://pica-mobile.invalid");
  } catch {
    return null;
  }

  const messageId = url.pathname.slice(VOICE_PATH.length + 1);

  if (
    request.method !== "GET" ||
    !url.pathname.startsWith(`${VOICE_PATH}/`) ||
    !/^[a-zA-Z0-9-]{1,100}$/u.test(messageId)
  ) {
    return null;
  }

  return messageId;
}

function respond(
  response: ServerResponse,
  status: number,
  error: string,
): void {
  const content = JSON.stringify({ ok: false, error });

  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(content),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(content);
}

/**
 * The voice endpoint of `conversations.v1` on the port of Pica Mobile:
 * `GET /pica-mobile/conversations/voice/<messageId>` (PAGE-278).
 *
 * @remarks
 * A request carries the session token of the app as `Authorization: Bearer`,
 * as the attachments of `chat.v1` do. Membership of the conversation is
 * checked on every request; a message of a conversation the account does not
 * belong to answers 404, as a missing one does. One account has at most four
 * transfers at once.
 */
export class PicaMobileConversationFiles {
  private readonly options: PicaMobileConversationFilesOptions;
  private readonly transfers = new Map<string, number>();

  /**
   * Creates the endpoint.
   *
   * @param options - Authentication and the conversations that hold the audio.
   */
  public constructor(options: PicaMobileConversationFilesOptions) {
    this.options = options;
  }

  /**
   * Answers a request when it addresses the voice endpoint.
   *
   * @param request - A plain HTTP request on the port of Pica Mobile.
   * @param response - Its answer.
   * @param clientAddress - The app's address, as the gateway decided it.
   * @returns Whether the request is the endpoint's; the caller answers every other one.
   */
  public handle(
    request: IncomingMessage,
    response: ServerResponse,
    clientAddress: string | null,
  ): boolean {
    const messageId = readVoiceMessageId(request);

    if (messageId === null) {
      return false;
    }

    void this.serve(request, response, {
      messageId,
      clientAddress,
    }).catch((error: unknown) => {
      logCaughtError(COMPONENT, error);

      if (response.headersSent) {
        response.destroy();
      } else {
        respond(response, 500, "general");
      }
    });

    return true;
  }

  private async serve(
    request: IncomingMessage,
    response: ServerResponse,
    target: {
      readonly messageId: string;
      readonly clientAddress: string | null;
    },
  ): Promise<void> {
    const session = await authenticatePicaMobileBearer(
      this.options.authenticator,
      request,
      readPicaMobileFileOrigin(request, target.clientAddress),
    );

    if (session === null) {
      respond(response, 401, "accessDenied");

      return;
    }

    const count = this.transfers.get(session.userId) ?? 0;

    if (count >= MAXIMUM_TRANSFERS_PER_ACCOUNT) {
      respond(response, 429, "tooManyTransfers");

      return;
    }

    this.transfers.set(session.userId, count + 1);

    try {
      const outcome = await this.options.conversations.openVoice(
        session,
        target.messageId,
      );

      if (outcome.kind === "sessionEnded") {
        respond(response, 401, "accessDenied");
      } else if (outcome.kind === "notFound") {
        respond(response, 404, "not_found");
      } else {
        response.writeHead(200, conversationVoiceHeaders(outcome.voice));
        // Resolves when the audio is out and rejects when the app breaks off; both free the place.
        await pipeline(outcome.stream, response);
      }
    } finally {
      this.release(session.userId);
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
