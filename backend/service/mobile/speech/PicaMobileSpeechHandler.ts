import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_MOBILE_ERROR_CODE } from "@/definition/PicaMobileProtocol";
import { PICA_MOBILE_MAXIMUM_SPEECH_CHUNK_BYTES } from "@/definition/PicaMobileSpeech";
import {
  readSpeechMimeType,
  SPEECH_MAXIMUM_BYTES,
} from "@/definition/SpeechRecognition";

import { encodePicaMobileSpeech } from "./PicaMobileSpeechMessages";

import type { PicaMobileSpeechAnswer } from "@/definition/PicaMobileSpeech";
import type { SpeechErrorCode } from "@/definition/SpeechRecognition";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type { PicaMobilePlansHost } from "../plans/PicaMobilePlansHandler";
import type { PicaMobileSpeechClientMessage } from "./PicaMobileSpeechMessages";
import type { PicaMobileSpeechProvider } from "./PicaMobileSpeechProvider";

type SpeechMessageOf<Type extends PicaMobileSpeechClientMessage["type"]> =
  Extract<PicaMobileSpeechClientMessage, { readonly type: Type }>;

/** The one recording of a connection, while it arrives or is recognized. */
interface ActiveRecording {
  readonly id: string;
  readonly mimeType: string;
  readonly chunks: Buffer[];
  readonly abort: AbortController;
  nextIndex: number;
  bytes: number;
  isConverting: boolean;
  timer: NodeJS.Timeout | null;
}

const COMPONENT = "PicaMobileSpeechHandler";
/** Silence after which an unfinished recording is dropped. */
const IDLE_MILLISECONDS = 60_000;
/** Refused recordings remembered, so their remaining chunks are dropped quietly. */
const MAXIMUM_FAILED_RECORDINGS = 32;

function clear(chunks: Buffer[]): void {
  for (const chunk of chunks) chunk.fill(0);
  chunks.length = 0;
}

/**
 * Answers `speech.v1` for one connection (PAGE-273): the limits and the
 * chunked recording that ends in its text.
 *
 * @remarks
 * A connection runs at most one recording at a time; a second `speech_start`
 * is refused with `invalid_sequence` and leaves the first one alone. Chunks
 * arrive in order, each at most 64 KB decoded and all together at most
 * 25 MB, and are held in memory only. A refusal answers once with
 * `speech_error`; further chunks of a refused recording are dropped quietly
 * and its `speech_finish` repeats the refusal. The recognition runs behind
 * the other messages of the connection, so a slow provider does not hold
 * them up. `speech_cancel`, a silent minute and a closing connection drop
 * the recording, cancel its recognition and clear its audio.
 */
export class PicaMobileSpeechHandler {
  private readonly provider: PicaMobileSpeechProvider | undefined;
  private readonly host: PicaMobilePlansHost;
  private readonly failed = new Map<string, SpeechErrorCode>();
  private active: ActiveRecording | null = null;

  /**
   * Creates the handler.
   *
   * @param provider - The speech recognition; none: the requests are unknown.
   * @param host - The connection the handler answers on.
   */
  public constructor(
    provider: PicaMobileSpeechProvider | undefined,
    host: PicaMobilePlansHost,
  ) {
    this.provider = provider;
    this.host = host;
  }

  /**
   * Handles one request of `speech.v1`.
   *
   * @param message - A request that passed every check of its payload.
   */
  public async handle(message: PicaMobileSpeechClientMessage): Promise<void> {
    const { host, provider } = this;
    if (!host.isOpen()) return;
    if (provider === undefined) {
      host.reject({
        code: PICA_MOBILE_ERROR_CODE.UNKNOWN_TYPE,
        message: "The message type is not known.",
        requestId: message.requestId,
      });
      return;
    }
    const session = host.session();
    if (session === null) {
      host.rejectUnauthenticated(message.requestId);
      return;
    }
    try {
      await this.dispatch(provider, message, session);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      this.drop();
      host.reportFailure(message.requestId, error);
    }
  }

  /** Drops the recording of a closing connection; nothing of its audio remains. */
  public stop(): void {
    this.drop();
    this.failed.clear();
  }

  private async dispatch(
    provider: PicaMobileSpeechProvider,
    message: PicaMobileSpeechClientMessage,
    session: PicaMobileSessionIdentity,
  ): Promise<void> {
    switch (message.type) {
      case "speech_config_get":
        await this.answerConfig(provider, message.requestId, session);
        return;
      case "speech_start":
        await this.start(provider, message, session);
        return;
      case "speech_chunk":
        this.receiveChunk(message);
        return;
      case "speech_finish":
        this.finish(provider, message, session);
        return;
      case "speech_cancel":
        if (this.active?.id === message.payload.id) this.drop();
        this.failed.delete(message.payload.id);
        this.host.acknowledge();
    }
  }

  private async answerConfig(
    provider: PicaMobileSpeechProvider,
    requestId: string,
    session: PicaMobileSessionIdentity,
  ): Promise<void> {
    const outcome = await provider.readLimits(session);
    if (outcome.kind === "sessionEnded") {
      this.host.endSession(requestId);
      return;
    }
    this.answer(
      requestId,
      outcome.limits === null
        ? {
            type: "speech_error",
            payload: { id: null, code: "not_configured" },
          }
        : { type: "speech_config", payload: outcome.limits },
    );
  }

  private async start(
    provider: PicaMobileSpeechProvider,
    message: SpeechMessageOf<"speech_start">,
    session: PicaMobileSessionIdentity,
  ): Promise<void> {
    const { id, mimeType, durationMs } = message.payload;
    this.failed.delete(id);
    if (this.active !== null) {
      this.send(message.requestId, id, "invalid_sequence");
      return;
    }
    const outcome = await provider.readLimits(session);
    if (outcome.kind === "sessionEnded") {
      this.host.endSession(message.requestId);
      return;
    }
    const code = this.refusalOfStart(outcome.limits, mimeType, durationMs);
    if (code !== null) {
      this.refuse(message.requestId, id, code);
      return;
    }
    this.active = {
      id,
      mimeType,
      chunks: [],
      abort: new AbortController(),
      nextIndex: 0,
      bytes: 0,
      isConverting: false,
      timer: null,
    };
    this.arm(this.active);
    this.host.acknowledge();
  }

  private refusalOfStart(
    limits: { readonly maxDurationMs: number } | null,
    mimeType: string,
    durationMs: number,
  ): SpeechErrorCode | null {
    if (limits === null) return "not_configured";
    if (readSpeechMimeType(mimeType) === null) return "unsupported_format";
    return durationMs > limits.maxDurationMs ? "too_long" : null;
  }

  private receiveChunk(message: SpeechMessageOf<"speech_chunk">): void {
    const { id, index, data: encoded } = message.payload;
    const recording = this.active;
    if (recording?.id !== id || recording.isConverting) {
      if (!this.failed.has(id))
        this.refuse(message.requestId, id, "invalid_sequence");
      return;
    }
    if (index !== recording.nextIndex) {
      this.refuse(message.requestId, id, "invalid_sequence");
      return;
    }
    const chunk = Buffer.from(encoded, "base64");
    recording.bytes += chunk.length;
    if (
      chunk.length > PICA_MOBILE_MAXIMUM_SPEECH_CHUNK_BYTES ||
      recording.bytes > SPEECH_MAXIMUM_BYTES
    ) {
      chunk.fill(0);
      this.refuse(message.requestId, id, "too_large");
      return;
    }
    recording.chunks.push(chunk);
    recording.nextIndex += 1;
    this.arm(recording);
    this.host.acknowledge();
  }

  private finish(
    provider: PicaMobileSpeechProvider,
    message: SpeechMessageOf<"speech_finish">,
    session: PicaMobileSessionIdentity,
  ): void {
    const { id, chunkCount } = message.payload;
    const recording = this.active;
    if (recording?.id !== id || recording.isConverting) {
      const code = this.failed.get(id) ?? "invalid_sequence";
      this.failed.delete(id);
      this.send(message.requestId, id, code);
      return;
    }
    if (chunkCount !== recording.nextIndex) {
      this.refuse(message.requestId, id, "invalid_sequence");
      this.failed.delete(id);
      return;
    }
    recording.isConverting = true;
    if (recording.timer !== null) clearTimeout(recording.timer);
    recording.timer = null;
    const audio = Buffer.concat(recording.chunks);
    clear(recording.chunks);
    this.host.acknowledge();
    void this.convert(provider, { message, session, recording, audio });
  }

  // Runs outside the queue of the connection; it handles its own errors.
  private async convert(
    provider: PicaMobileSpeechProvider,
    input: {
      readonly message: SpeechMessageOf<"speech_finish">;
      readonly session: PicaMobileSessionIdentity;
      readonly recording: ActiveRecording;
      readonly audio: Buffer;
    },
  ): Promise<void> {
    const { message, session, recording, audio } = input;
    try {
      const outcome = await provider.transcribe(session, {
        audio,
        mimeType: recording.mimeType,
        signal: recording.abort.signal,
      });
      if (this.active !== recording || !this.host.isOpen()) return;
      this.active = null;
      if (outcome.kind === "sessionEnded") {
        this.host.endSession(message.requestId);
        return;
      }
      this.answer(
        message.requestId,
        outcome.outcome.ok
          ? {
              type: "speech_result",
              payload: { id: recording.id, text: outcome.outcome.text },
            }
          : {
              type: "speech_error",
              payload: { id: recording.id, code: outcome.outcome.code },
            },
      );
    } catch (error: unknown) {
      if (this.active !== recording) return;
      this.active = null;
      logCaughtError(COMPONENT, error);

      this.host.reportFailure(message.requestId, error);
    } finally {
      audio.fill(0);
    }
  }

  /** Drops the recording, remembers why and tells the app once. */
  private refuse(
    requestId: string | null,
    id: string,
    code: SpeechErrorCode,
  ): void {
    if (this.active?.id === id && !this.active.isConverting) this.drop();
    this.failed.set(id, code);
    if (this.failed.size > MAXIMUM_FAILED_RECORDINGS) {
      const [oldest] = this.failed.keys();
      if (oldest !== undefined) this.failed.delete(oldest);
    }
    this.send(requestId, id, code);
  }

  private drop(): void {
    const recording = this.active;
    if (recording === null) return;
    this.active = null;
    if (recording.timer !== null) clearTimeout(recording.timer);
    recording.timer = null;
    recording.abort.abort();
    clear(recording.chunks);
  }

  private send(
    requestId: string | null,
    id: string,
    code: SpeechErrorCode,
  ): void {
    this.answer(requestId, { type: "speech_error", payload: { id, code } });
  }

  private answer(
    requestId: string | null,
    answer: PicaMobileSpeechAnswer,
  ): void {
    if (!this.host.isOpen()) return;
    this.host.acknowledge();
    this.host.send(encodePicaMobileSpeech(requestId, answer));
  }

  private arm(recording: ActiveRecording): void {
    if (recording.timer !== null) clearTimeout(recording.timer);
    recording.timer = setTimeout(() => {
      this.refuse(null, recording.id, "invalid_sequence");
    }, IDLE_MILLISECONDS);
    recording.timer.unref();
  }
}
