import { logCaughtError } from "@/backend/logging/Logger";
import { CONVERSATION_VOICE_MAXIMUM_BYTES } from "@/definition/Conversation";
import { PICA_MOBILE_MAXIMUM_VOICE_CHUNK_BYTES } from "@/definition/PicaMobileConversations";

import { encodePicaMobileConversation } from "../PicaMobileMessages";

import type { ConversationErrorCode } from "@/definition/Conversation";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type { PicaMobileConversationClientMessage } from "../PicaMobileMessages";
import type { PicaMobilePlansHost } from "../plans/PicaMobilePlansHandler";
import type {
  PicaMobileConversationOutcome,
  PicaMobileConversationsProvider,
  PicaMobileVoiceSink,
} from "./PicaMobileConversationsProvider";

/** A request of the chunked voice upload. */
export type PicaMobileVoiceMessage = Extract<
  PicaMobileConversationClientMessage,
  { readonly type: `voice_${string}` }
>;

type VoiceMessageOf<Type extends PicaMobileVoiceMessage["type"]> = Extract<
  PicaMobileVoiceMessage,
  { readonly type: Type }
>;

interface ActiveUpload {
  readonly sink: PicaMobileVoiceSink;
  nextIndex: number;
  bytes: number;
  timer: NodeJS.Timeout | null;
}

const COMPONENT = "PicaMobileVoiceUploads";
/** Uploads one connection runs at once. */
const MAXIMUM_ACTIVE_UPLOADS = 2;
/** Refused uploads remembered, so their remaining chunks are dropped quietly. */
const MAXIMUM_FAILED_UPLOADS = 32;
/** Silence after which an unfinished upload is dropped. */
const IDLE_MILLISECONDS = 60_000;

/**
 * The chunked voice upload of `conversations.v1` for one connection
 * (PAGE-278): `voice_start`, `voice_chunk`, `voice_finish`, `voice_cancel`.
 *
 * @remarks
 * Chunks must arrive in order, each at most 64 KB decoded and all together
 * at most 25 MB; the audio streams to the file store as it comes. Only a
 * refusal answers before `voice_finish`, once per upload, with
 * `conversation_error` and the upload's ID; further chunks of a refused
 * upload are dropped quietly and its `voice_finish` repeats the refusal.
 * `voice_finish` answers with the stored message, `voice_cancel` with
 * nothing. An upload that stays silent for a minute, and every upload of a
 * closing connection, is dropped and leaves nothing behind.
 */
export class PicaMobileVoiceUploads {
  private readonly provider: PicaMobileConversationsProvider;
  private readonly host: PicaMobilePlansHost;
  private readonly connectionId: string;
  private readonly active = new Map<string, ActiveUpload>();
  private readonly failed = new Map<string, ConversationErrorCode>();

  /**
   * Creates the uploads of a connection.
   *
   * @param provider - Checks and stores the voice messages.
   * @param host - The connection the uploads answer on.
   * @param connectionId - The connection, whose own messages come back as answers.
   */
  public constructor(
    provider: PicaMobileConversationsProvider,
    host: PicaMobilePlansHost,
    connectionId: string,
  ) {
    this.provider = provider;
    this.host = host;
    this.connectionId = connectionId;
  }

  /**
   * Handles one request of the voice upload.
   *
   * @param message - A request that passed every check of its payload.
   * @param session - The account and session of the connection.
   */
  public async handle(
    message: PicaMobileVoiceMessage,
    session: PicaMobileSessionIdentity,
  ): Promise<void> {
    switch (message.type) {
      case "voice_start":
        await this.start(message, session);
        return;
      case "voice_chunk":
        this.receiveChunk(message);
        return;
      case "voice_finish":
        await this.finish(message);
        return;
      case "voice_cancel":
        this.cancel(message.payload.id);
    }
  }

  /** Drops every unfinished upload; nothing remains of them. */
  public stop(): void {
    for (const id of [...this.active.keys()]) this.cancel(id);
  }

  private async start(
    message: VoiceMessageOf<"voice_start">,
    session: PicaMobileSessionIdentity,
  ): Promise<void> {
    const { id } = message.payload;
    this.failed.delete(id);
    if (this.active.has(id) || this.active.size >= MAXIMUM_ACTIVE_UPLOADS) {
      this.refuse(message.requestId, id, "invalid");
      return;
    }
    const outcome = await this.provider.beginVoice(
      { session, originId: this.connectionId },
      message.payload,
    );
    if (outcome.kind === "sessionEnded") {
      this.host.endSession(message.requestId);
      return;
    }
    if (outcome.kind === "failed") {
      this.refuse(message.requestId, id, outcome.code);
      return;
    }
    if (!this.host.isOpen()) {
      outcome.sink.cancel();
      return;
    }
    const upload: ActiveUpload = {
      sink: outcome.sink,
      nextIndex: 0,
      bytes: 0,
      timer: null,
    };
    this.active.set(id, upload);
    this.arm(id, upload);
    this.host.acknowledge();
  }

  private receiveChunk(message: VoiceMessageOf<"voice_chunk">): void {
    const { id, index, data: encoded } = message.payload;
    const upload = this.active.get(id);
    if (!upload) {
      if (!this.failed.has(id)) this.refuse(message.requestId, id, "not_found");
      return;
    }
    if (index !== upload.nextIndex) {
      this.refuse(message.requestId, id, "invalid");
      return;
    }
    const chunk = Buffer.from(encoded, "base64");
    upload.bytes += chunk.length;
    if (
      chunk.length > PICA_MOBILE_MAXIMUM_VOICE_CHUNK_BYTES ||
      upload.bytes > CONVERSATION_VOICE_MAXIMUM_BYTES
    ) {
      this.refuse(message.requestId, id, "too_large");
      return;
    }
    upload.sink.write(chunk);
    upload.nextIndex += 1;
    this.arm(id, upload);
    this.host.acknowledge();
  }

  private async finish(message: VoiceMessageOf<"voice_finish">): Promise<void> {
    const { id, chunkCount } = message.payload;
    const upload = this.active.get(id);
    if (!upload) {
      const code = this.failed.get(id) ?? "not_found";
      this.failed.delete(id);
      this.send(message.requestId, id, code);
      return;
    }
    if (chunkCount !== upload.nextIndex) {
      this.refuse(message.requestId, id, "invalid");
      this.failed.delete(id);
      return;
    }
    this.release(id, upload);
    let outcome: PicaMobileConversationOutcome;
    try {
      outcome = await upload.sink.finish();
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      this.host.reportFailure(message.requestId, error);
      return;
    }
    this.answer(message.requestId, outcome);
  }

  private cancel(id: string): void {
    const upload = this.active.get(id);
    this.failed.delete(id);
    if (!upload) return;
    this.release(id, upload);
    upload.sink.cancel();
  }

  private answer(
    requestId: string,
    outcome: PicaMobileConversationOutcome,
  ): void {
    if (!this.host.isOpen()) return;
    if (outcome.kind === "sessionEnded") {
      this.host.endSession(requestId);
      return;
    }
    this.host.acknowledge();
    this.host.send(encodePicaMobileConversation(requestId, outcome.answer));
  }

  /** Drops an upload, remembers why and tells the app once. */
  private refuse(
    requestId: string | null,
    id: string,
    code: ConversationErrorCode,
  ): void {
    const upload = this.active.get(id);
    if (upload) {
      this.release(id, upload);
      upload.sink.cancel();
    }
    this.failed.set(id, code);
    if (this.failed.size > MAXIMUM_FAILED_UPLOADS) {
      const [oldest] = this.failed.keys();
      if (oldest !== undefined) this.failed.delete(oldest);
    }
    this.send(requestId, id, code);
  }

  private send(
    requestId: string | null,
    id: string,
    code: ConversationErrorCode,
  ): void {
    if (!this.host.isOpen()) return;
    this.host.send(
      encodePicaMobileConversation(requestId, {
        type: "conversation_error",
        payload: { id, code },
      }),
    );
  }

  private arm(id: string, upload: ActiveUpload): void {
    if (upload.timer !== null) clearTimeout(upload.timer);
    upload.timer = setTimeout(() => {
      this.refuse(null, id, "invalid");
    }, IDLE_MILLISECONDS);
    upload.timer.unref();
  }

  private release(id: string, upload: ActiveUpload): void {
    if (upload.timer !== null) clearTimeout(upload.timer);
    upload.timer = null;
    this.active.delete(id);
  }
}
