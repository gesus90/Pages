import type { SpeechMimeType } from "@/definition/SpeechRecognition";

/** What Pages reads from a recording before it passes it on. */
export interface SpeechAudioFacts {
  /** The playing time the audio itself states, rounded up to whole milliseconds. */
  readonly durationMs: number;
}

interface Mp3Frame {
  readonly length: number;
  readonly samples: number;
  readonly sampleRate: number;
}

/** How far the first MP3 frame may lie behind the ID3 tag. */
const MP3_SYNC_SEARCH_BYTES = 4096;

const MP3_BITRATES: Readonly<Record<string, readonly number[]>> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

// MPEG version bits: 0 is MPEG 2.5, 2 is MPEG 2, 3 is MPEG 1; 1 is reserved.
const MP3_SAMPLE_RATES: Readonly<Record<number, readonly number[]>> = {
  0: [11_025, 12_000, 8_000],
  2: [22_050, 24_000, 16_000],
  3: [44_100, 48_000, 32_000],
};

function readWavDuration(audio: Buffer): number | null {
  if (
    audio.length < 12 ||
    audio.toString("latin1", 0, 4) !== "RIFF" ||
    audio.toString("latin1", 8, 12) !== "WAVE"
  )
    return null;
  let byteRate = 0;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const id = audio.toString("latin1", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 12 <= audio.length)
      byteRate = audio.readUInt32LE(body + 8);
    if (id === "data") {
      if (byteRate === 0) return null;
      // A recorder that streams may leave the size open; the remaining bytes count then.
      const available = audio.length - body;
      const dataBytes = size === 0 || size > available ? available : size;
      return Math.ceil((dataBytes * 1000) / byteRate);
    }
    offset = body + size + (size % 2);
  }
  return null;
}

function skipId3(audio: Buffer): number {
  if (audio.length < 10 || audio.toString("latin1", 0, 3) !== "ID3") return 0;
  const size =
    ((audio[6] & 0x7f) << 21) |
    ((audio[7] & 0x7f) << 14) |
    ((audio[8] & 0x7f) << 7) |
    (audio[9] & 0x7f);
  const footer = (audio[5] & 0x10) === 0 ? 0 : 10;
  return 10 + size + footer;
}

function readMp3Frame(audio: Buffer, offset: number): Mp3Frame | null {
  if (offset + 4 > audio.length) return null;
  const [sync, second, third] = [
    audio[offset],
    audio[offset + 1],
    audio[offset + 2],
  ];
  if (sync !== 0xff || (second & 0xe0) !== 0xe0) return null;
  const version = (second >> 3) & 3;
  const layer = 4 - ((second >> 1) & 3);
  const sampleRate = MP3_SAMPLE_RATES[version]?.[(third >> 2) & 3];
  const family = version === 3 ? 1 : 2;
  const bitrate = MP3_BITRATES[`${family}-${layer}`]?.[third >> 4];
  if (layer > 3 || sampleRate === undefined || !bitrate) return null;
  const padding = (third >> 1) & 1;
  if (layer === 1)
    return {
      length: (Math.floor((12_000 * bitrate) / sampleRate) + padding) * 4,
      samples: 384,
      sampleRate,
    };
  const samples = layer === 3 && family === 2 ? 576 : 1152;
  return {
    length: Math.floor(((samples / 8) * bitrate * 1000) / sampleRate) + padding,
    samples,
    sampleRate,
  };
}

function findFirstMp3Frame(audio: Buffer, start: number): number | null {
  const end = Math.min(audio.length, start + MP3_SYNC_SEARCH_BYTES);
  for (let offset = start; offset < end; offset += 1) {
    if (readMp3Frame(audio, offset) !== null) return offset;
  }
  return null;
}

// Every frame header states its own length and samples, so the frames add
// up to the playing time also for a recording with a variable bit rate.
function readMp3Duration(audio: Buffer): number | null {
  let offset = findFirstMp3Frame(audio, skipId3(audio));
  if (offset === null) return null;
  let seconds = 0;
  for (
    let frame = readMp3Frame(audio, offset);
    frame !== null;
    frame = readMp3Frame(audio, offset)
  ) {
    seconds += frame.samples / frame.sampleRate;
    offset += frame.length;
  }
  return Math.ceil(seconds * 1000);
}

/**
 * Reads the playing time of a recording in its declared format.
 *
 * @param audio - The complete recording, held in memory only.
 * @param mimeType - The format the sender declared.
 * @returns The facts, or `null` when the bytes are not audio of that format.
 *
 * @remarks
 * Pages converts no audio; it only checks that WAV starts as RIFF/WAVE with
 * a format and a data chunk, and that MP3 holds MPEG audio frames after an
 * optional ID3 tag. The time comes from the audio, not from the sender.
 */
export function inspectSpeechAudio(
  audio: Buffer,
  mimeType: SpeechMimeType,
): SpeechAudioFacts | null {
  const durationMs =
    mimeType === "audio/wav" ? readWavDuration(audio) : readMp3Duration(audio);
  return durationMs === null ? null : { durationMs };
}
