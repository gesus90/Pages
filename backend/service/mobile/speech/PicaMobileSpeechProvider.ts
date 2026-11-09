import type {
  SpeechMimeType,
  SpeechTestOutcome,
} from "@/definition/SpeechRecognition";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";

/** The limits a recording of the app must keep. */
export interface PicaMobileSpeechLimits {
  readonly maxDurationMs: number;
  readonly mimeTypes: readonly SpeechMimeType[];
}

/**
 * What the speech recognition answers for a connection.
 *
 * @remarks
 * `sessionEnded` means the session or the account no longer holds; the
 * connection ends as it does when its regular session check fails. `limits`
 * is `null` while speech recognition is off or the account may not use Pica.
 */
export type PicaMobileSpeechLimitsOutcome =
  | { readonly kind: "limits"; readonly limits: PicaMobileSpeechLimits | null }
  | { readonly kind: "sessionEnded" };

/** The text of a finished recording, or why there is none. */
export type PicaMobileSpeechOutcome =
  | { readonly kind: "result"; readonly outcome: SpeechTestOutcome }
  | { readonly kind: "sessionEnded" };

/** One finished recording of the app. */
export interface PicaMobileSpeechRecording {
  /** The complete audio, held in memory only; it is cleared after use. */
  readonly audio: Buffer;
  readonly mimeType: string;
  /** Cancels the recognition when the app cancels or the connection closes. */
  readonly signal: AbortSignal;
}

/**
 * The speech recognition of the instance for Pica Mobile (`speech.v1`, PAGE-273).
 *
 * @remarks
 * A connection without a provider does not announce `speech.v1` and answers
 * its requests as unknown. Every call checks the session first.
 */
export interface PicaMobileSpeechProvider {
  /** Whether the connection of the account announces `speech.v1` now. */
  isAvailable(session: PicaMobileSessionIdentity): Promise<boolean>;
  /** Reads the limits that apply now. */
  readLimits(
    session: PicaMobileSessionIdentity,
  ): Promise<PicaMobileSpeechLimitsOutcome>;
  /** Recognizes the text of a finished recording. */
  transcribe(
    session: PicaMobileSessionIdentity,
    recording: PicaMobileSpeechRecording,
  ): Promise<PicaMobileSpeechOutcome>;
}
