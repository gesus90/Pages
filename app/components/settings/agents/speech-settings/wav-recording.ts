/** The sample rate of a test recording; speech needs no more. */
export const WAV_SAMPLE_RATE = 16_000;

const WAV_HEADER_BYTES = 44;

/**
 * Joins the recorded blocks of samples into one.
 *
 * @param blocks - The blocks in the order they were recorded.
 * @returns All samples in one array.
 */
export function joinSamples(blocks: readonly Float32Array[]): Float32Array {
  const length = blocks.reduce((sum, block) => sum + block.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const block of blocks) {
    samples.set(block, offset);
    offset += block.length;
  }
  return samples;
}

/**
 * Brings samples to {@link WAV_SAMPLE_RATE} by averaging the samples each
 * output sample covers.
 *
 * @param samples - Mono samples of the microphone.
 * @param sourceRate - The sample rate of the audio context.
 * @returns The samples at the target rate; unchanged when the rate already fits.
 */
export function resampleTo16k(
  samples: Float32Array,
  sourceRate: number,
): Float32Array {
  if (sourceRate <= WAV_SAMPLE_RATE) return samples;
  const ratio = sourceRate / WAV_SAMPLE_RATE;
  const output = new Float32Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let source = start; source < end; source += 1) sum += samples[source];
    output[index] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

function writeText(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1)
    view.setUint8(offset + index, text.charCodeAt(index));
}

/**
 * Encodes mono samples as a 16-bit PCM WAV file.
 *
 * @param samples - Samples between -1 and 1 at {@link WAV_SAMPLE_RATE}.
 * @returns The file as `audio/wav`.
 */
export function encodeWav(samples: Float32Array): Blob {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  writeText(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(view, 8, "WAVE");
  writeText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, WAV_SAMPLE_RATE, true);
  view.setUint32(28, WAV_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      WAV_HEADER_BYTES + index * 2,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
  });
  return new Blob([buffer], { type: "audio/wav" });
}
