import type { AgentCallSilenceReason } from "@/definition/AgentCall";

/** What a recording holds of speech. */
export interface UtteranceFacts {
  readonly durationMs: number;
  /** How long the signal was clearly above the background level, in milliseconds. */
  readonly activeMs: number;
  readonly peak: number;
}

const FRAME_MS = 20;

/** The level of a frame, from 0 to 1, from which it counts as sound. */
const ACTIVE_LEVEL = 0.012;

/** The shortest sound that can be a word. */
const MINIMUM_ACTIVE_MS = 200;

/** The peak below which a recording is a line without a voice. */
const MINIMUM_PEAK = 0.02;

/** Texts a recognizer invents for silence or music; they are no speech. */
const INVENTED_TEXT =
  /^(?:untertitel\b|subtitles?\s+by\b|thanks?\s+for\s+watching|vielen\s+dank\s+f[üu]rs\s+zuschauen|danke\s+f[üu]rs\s+zuschauen)/iu;

interface WavSamples {
  readonly sampleRate: number;
  readonly samples: Int16Array;
}

function readWavSamples(audio: Buffer): WavSamples | null {
  if (
    audio.length < 44 ||
    audio.toString("latin1", 0, 4) !== "RIFF" ||
    audio.toString("latin1", 8, 12) !== "WAVE"
  )
    return null;
  let sampleRate = 0;
  let isPcm16 = false;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const id = audio.toString("latin1", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= audio.length) {
      sampleRate = audio.readUInt32LE(body + 4);
      isPcm16 =
        audio.readUInt16LE(body) === 1 &&
        audio.readUInt16LE(body + 2) === 1 &&
        audio.readUInt16LE(body + 14) === 16;
    }
    if (id === "data") {
      if (!isPcm16 || sampleRate === 0) return null;
      const available = audio.length - body;
      const bytes = Math.min(size === 0 ? available : size, available);
      const count = Math.floor(bytes / 2);
      const samples = new Int16Array(count);
      for (let index = 0; index < count; index += 1)
        samples[index] = audio.readInt16LE(body + index * 2);
      return { sampleRate, samples };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/**
 * Measures how much sound a mono 16-bit WAV recording holds.
 * @param audio - The recording.
 * @returns Duration, sound time and peak, or `null` for any other format.
 */
export function measureUtterance(audio: Buffer): UtteranceFacts | null {
  const wav = readWavSamples(audio);
  if (wav === null) return null;
  const frame = Math.max(1, Math.floor((wav.sampleRate * FRAME_MS) / 1000));
  let activeFrames = 0;
  let peak = 0;
  for (let start = 0; start < wav.samples.length; start += frame) {
    const end = Math.min(wav.samples.length, start + frame);
    let sum = 0;
    for (let index = start; index < end; index += 1) {
      const level = Math.abs(wav.samples[index]) / 32768;
      peak = Math.max(peak, level);
      sum += level * level;
    }
    if (Math.sqrt(sum / (end - start)) >= ACTIVE_LEVEL) activeFrames += 1;
  }
  return {
    durationMs: Math.round((wav.samples.length * 1000) / wav.sampleRate),
    activeMs: activeFrames * FRAME_MS,
    peak,
  };
}

/**
 * Whether a recording is too quiet or too short to hold speech, so that no
 * provider has to be asked.
 * @param facts - What {@link measureUtterance} read.
 */
export function isSilentUtterance(facts: UtteranceFacts): boolean {
  return facts.activeMs < MINIMUM_ACTIVE_MS || facts.peak < MINIMUM_PEAK;
}

/**
 * Tells why a recognized text is no request to the agent.
 * @param text - What the recognition returned.
 * @returns `empty` without a letter or digit, `noise` for a sound the
 * recognizer described in brackets or invented for silence, `null` for speech.
 */
export function noiseReasonOf(text: string): AgentCallSilenceReason | null {
  const trimmed = text.trim();
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return "empty";
  if (/^[[(*♪].*[\])*♪]$/u.test(trimmed) && trimmed.length <= 40)
    return "noise";
  return INVENTED_TEXT.test(trimmed) ? "noise" : null;
}
