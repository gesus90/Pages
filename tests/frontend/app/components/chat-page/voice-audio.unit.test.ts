import { expect, it } from "vitest";

import {
  downsample,
  encodeWave,
  formatVoiceDuration,
  VOICE_SAMPLE_RATE,
  VOICE_WAVE_BARS,
  wavePeaks,
} from "@/app/components/chat-page/voice-audio";

it("joins blocks and averages samples at the target rate", () => {
  const blocks = [
    new Float32Array([1, -1, 0.5]),
    new Float32Array([0.5, -0.5, -0.5]),
  ];
  expect(Array.from(downsample(blocks, 32_000))).toEqual([0, 0.5, -0.5]);
  expect(Array.from(downsample(blocks, 8_000))).toEqual([
    1, -1, 0.5, 0.5, -0.5, -0.5,
  ]);
  expect(downsample([], 48_000)).toHaveLength(0);
});

it("encodes a mono PCM WAV header and clamps samples", async () => {
  const blob = encodeWave(new Float32Array([-2, 0, 0.5, 2]));
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("Expected binary WAV"));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  const view = new DataView(bytes);
  expect(blob.type).toBe("audio/wav");
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
  expect(new TextDecoder().decode(bytes.slice(8, 16))).toBe("WAVEfmt ");
  expect(view.getUint32(4, true)).toBe(44);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(VOICE_SAMPLE_RATE);
  expect(view.getUint32(40, true)).toBe(8);
  expect([44, 46, 48, 50].map((offset) => view.getInt16(offset, true))).toEqual(
    [-32767, 0, 16384, 32767],
  );
});

it("normalizes waveform peaks and handles silence", () => {
  const samples = new Float32Array(VOICE_WAVE_BARS);
  samples[0] = -1;
  samples[1] = 0.5;
  expect(wavePeaks(samples).slice(0, 3)).toEqual([1, 0.5, 0]);
  expect(wavePeaks(new Float32Array()).every((peak) => peak === 0)).toBe(true);
});

it("rounds and formats nonnegative durations", () => {
  expect(formatVoiceDuration(-1)).toBe("0:00");
  expect(formatVoiceDuration(59_500)).toBe("1:00");
  expect(formatVoiceDuration(125_000)).toBe("2:05");
});
