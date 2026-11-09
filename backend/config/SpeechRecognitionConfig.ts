import path from "node:path";

import {
  CONVERSATION_VOICE_DEFAULT_DURATION_SECONDS,
  CONVERSATION_VOICE_DURATION_RANGE_SECONDS,
} from "@/definition/Conversation";

import type { TomlTable } from "smol-toml";

/** The table of `config.toml` that holds the speech recognition. */
export const SPEECH_RECOGNITION_KEY = "speechRecognition";

/**
 * The speech recognition of voice messages (PAGE-277), a server setting
 * until Pages has one under Settings → Agents.
 *
 * @example
 * ```toml
 * [speechRecognition]
 * model = "whisper-1"
 * url = "https://api.openai.com/v1/audio/transcriptions"
 * apiKeyFile = "/etc/pages/speech-key"
 * maximumRecordingSeconds = 300
 * ```
 */
export interface SpeechRecognitionSetting {
  /** The speech model the provider runs; missing: no recognition. */
  readonly model?: string;
  /** The OpenAI-compatible transcription endpoint the audio is sent to. */
  readonly url?: string;
  /** Absolute path of the file that holds the API key; missing: no key is sent. */
  readonly apiKeyFile?: string;
  /** Longest voice message in seconds, 1 to 3600; missing: 300. */
  readonly maximumRecordingSeconds?: number;
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function isRecordingSeconds(input: unknown): input is number {
  return (
    typeof input === "number" &&
    Number.isInteger(input) &&
    input >= CONVERSATION_VOICE_DURATION_RANGE_SECONDS.minimum &&
    input <= CONVERSATION_VOICE_DURATION_RANGE_SECONDS.maximum
  );
}

function readModel(table: TomlTable): Pick<SpeechRecognitionSetting, "model"> {
  const { model } = table;
  if (model === undefined) return {};
  if (typeof model !== "string" || model.trim() === "")
    throw new Error('"speechRecognition.model" must be a model name.');
  return { model: model.trim() };
}

function readEndpoint(
  table: TomlTable,
): Pick<SpeechRecognitionSetting, "url" | "apiKeyFile"> {
  const { url, apiKeyFile } = table;
  if (url !== undefined && (typeof url !== "string" || !isHttpUrl(url)))
    throw new Error(
      '"speechRecognition.url" must be an http or https address without credentials.',
    );
  if (
    apiKeyFile !== undefined &&
    (typeof apiKeyFile !== "string" || !path.isAbsolute(apiKeyFile))
  )
    throw new Error(
      '"speechRecognition.apiKeyFile" must be an absolute file path.',
    );
  return {
    ...(url === undefined ? {} : { url }),
    ...(apiKeyFile === undefined
      ? {}
      : { apiKeyFile: path.normalize(apiKeyFile) }),
  };
}

function isTable(input: unknown): input is TomlTable {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    !(input instanceof Date)
  );
}

function readRecordingLimit(
  table: TomlTable,
): Pick<SpeechRecognitionSetting, "maximumRecordingSeconds"> {
  const seconds = table.maximumRecordingSeconds;
  if (seconds === undefined) return {};
  if (!isRecordingSeconds(seconds))
    throw new Error(
      `"speechRecognition.maximumRecordingSeconds" must be a whole number from ${CONVERSATION_VOICE_DURATION_RANGE_SECONDS.minimum} to ${CONVERSATION_VOICE_DURATION_RANGE_SECONDS.maximum}.`,
    );
  return { maximumRecordingSeconds: seconds };
}

/**
 * Reads the speech recognition from a parsed configuration file.
 *
 * @param document - Parsed TOML document.
 * @returns The setting, or nothing when the file names none.
 * @throws {Error} When a value of the table is malformed; the message never
 * quotes a value.
 */
export function readSpeechRecognitionConfig(document: TomlTable): {
  readonly speechRecognition?: SpeechRecognitionSetting;
} {
  const table = document[SPEECH_RECOGNITION_KEY];
  if (table === undefined) return {};
  if (!isTable(table)) throw new Error('"speechRecognition" must be a table.');
  return {
    speechRecognition: {
      ...readModel(table),
      ...readEndpoint(table),
      ...readRecordingLimit(table),
    },
  };
}

/**
 * Returns the longest voice message the setting allows.
 *
 * @param setting - The speech recognition of the configuration.
 * @returns Milliseconds; 300 seconds without a setting.
 */
export function voiceMaximumDurationMs(
  setting: SpeechRecognitionSetting | undefined,
): number {
  return (
    (setting?.maximumRecordingSeconds ??
      CONVERSATION_VOICE_DEFAULT_DURATION_SECONDS) * 1000
  );
}
