/** The layout of raw PCM audio. */
export interface PcmLayout {
  readonly sampleRate: number;
  readonly channels: number;
}

/**
 * OpenRouter's PCM: 16-bit little-endian, 24 kHz, mono, unless the
 * `Content-Type` names other values (PAGE-300).
 */
const DEFAULT_PCM_LAYOUT: PcmLayout = { sampleRate: 24_000, channels: 1 };

const BITS_PER_SAMPLE = 16;
const HEADER_BYTES = 44;

function readParameter(contentType: string, name: string): number | null {
  for (const part of contentType.split(";").slice(1)) {
    const [key = "", value = ""] = part.split("=");
    if (key.trim().toLowerCase() !== name) continue;
    const number = Number(value.trim());
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  return null;
}

/**
 * Reads the layout of raw PCM from its content type.
 *
 * @param contentType - Such as `audio/pcm;rate=24000;channels=1`.
 * @returns The stated sample rate and channels, OpenRouter's defaults for
 * values it leaves out or states outside a sane range.
 */
export function readPcmLayout(contentType: string): PcmLayout {
  const sampleRate = readParameter(contentType, "rate");
  const channels = readParameter(contentType, "channels");
  return {
    sampleRate:
      sampleRate !== null && sampleRate >= 8_000 && sampleRate <= 96_000
        ? sampleRate
        : DEFAULT_PCM_LAYOUT.sampleRate,
    channels:
      channels !== null && channels <= 2
        ? channels
        : DEFAULT_PCM_LAYOUT.channels,
  };
}

/**
 * Wraps raw 16-bit PCM into a WAV file a browser plays.
 *
 * @param pcm - The samples, 16-bit little-endian.
 * @param layout - Sample rate and channels of the samples.
 * @returns The WAV file; a trailing odd byte is dropped.
 */
export function wavFromPcm(pcm: Buffer, layout: PcmLayout): Buffer {
  const blockAlign = (layout.channels * BITS_PER_SAMPLE) / 8;
  const dataBytes = pcm.length - (pcm.length % blockAlign);
  const header = Buffer.alloc(HEADER_BYTES);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(HEADER_BYTES - 8 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(layout.channels, 22);
  header.writeUInt32LE(layout.sampleRate, 24);
  header.writeUInt32LE(layout.sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, pcm.subarray(0, dataBytes)]);
}
