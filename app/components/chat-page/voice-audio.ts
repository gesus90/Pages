/** The rate a recording is stored at: speech needs no more, and five minutes stay below 10 MB. */
export const VOICE_SAMPLE_RATE = 16_000;

/** Bars of the waveform of a voice message. */
export const VOICE_WAVE_BARS = 48;

/** The types the chat page sends; anything else the server refuses as well. */
export const VOICE_FILE_TYPES: Readonly<Record<string, string>> = {
  "audio/wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
};

const WAVE_HEADER_BYTES = 44;
const PCM_MAXIMUM = 0x7fff;

/**
 * Joins the recorded blocks and lowers them to {@link VOICE_SAMPLE_RATE} by
 * averaging, so no other format and no library is involved.
 *
 * @param blocks - The recorded blocks of one channel.
 * @param sourceRate - The sample rate they were recorded at.
 * @returns The samples at the stored rate.
 */
export function downsample(
  blocks: readonly Float32Array[],
  sourceRate: number,
): Float32Array {
  const length = blocks.reduce((total, block) => total + block.length, 0);
  const joined = new Float32Array(length);
  let offset = 0;
  for (const block of blocks) {
    joined.set(block, offset);
    offset += block.length;
  }
  const ratio = Math.max(1, sourceRate / VOICE_SAMPLE_RATE);
  const result = new Float32Array(Math.floor(length / ratio));
  for (let index = 0; index < result.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let source = start; source < end; source += 1)
      sum += joined[source] ?? 0;
    result[index] = sum / Math.max(1, end - start);
  }
  return result;
}

/**
 * Writes samples as a mono WAV file with 16-bit PCM.
 *
 * @param samples - Samples from -1 to 1 at {@link VOICE_SAMPLE_RATE}.
 * @returns The file.
 */
export function encodeWave(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(WAVE_HEADER_BYTES + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (at: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1)
      view.setUint8(at + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      WAVE_HEADER_BYTES + index * 2,
      Math.round(clamped * PCM_MAXIMUM),
      true,
    );
  });
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * The loudest sample of each bar, scaled to the loudest bar.
 *
 * @param samples - The samples of one channel.
 * @returns One value from 0 to 1 per bar of {@link VOICE_WAVE_BARS}.
 */
export function wavePeaks(samples: Float32Array): number[] {
  const step = Math.max(1, Math.floor(samples.length / VOICE_WAVE_BARS));
  const values = Array.from({ length: VOICE_WAVE_BARS }, (_, index) => {
    let peak = 0;
    for (let offset = index * step; offset < (index + 1) * step; offset += 16)
      peak = Math.max(peak, Math.abs(samples[offset] ?? 0));
    return peak;
  });
  const highest = Math.max(...values, 0.0001);
  return values.map((peak) => peak / highest);
}

/**
 * Decodes an audio file in the browser.
 *
 * @param bytes - The content of the file.
 * @returns The decoded audio; it rejects for content the browser cannot read.
 */
export async function decodeAudio(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(bytes);
  } finally {
    void context.close();
  }
}

/**
 * `m:ss` of a duration.
 *
 * @param durationMs - Milliseconds.
 * @returns The duration as minutes and seconds.
 */
export function formatVoiceDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
