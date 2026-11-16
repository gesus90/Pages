import { describe, expect, it } from "vitest";

import {
  readPcmLayout,
  wavFromPcm,
} from "@/backend/service/speech/SpeechSynthesisAudio";

describe("PCM audio layout", () => {
  it("uses valid declared values and defaults invalid or absent parameters", () => {
    expect(readPcmLayout("audio/pcm; RATE=48000; channels=2")).toEqual({
      sampleRate: 48000,
      channels: 2,
    });
    for (const value of [
      "audio/pcm",
      "audio/pcm;rate=1;channels=3",
      "audio/pcm;rate=bad;channels=0",
      "audio/pcm;rate=96001;channels=1.5",
    ]) {
      expect(readPcmLayout(value)).toEqual({ sampleRate: 24000, channels: 1 });
    }
  });

  it("writes a WAV header and drops incomplete samples", () => {
    const wav = wavFromPcm(Buffer.from([1, 2, 3, 4, 5]), {
      sampleRate: 48000,
      channels: 2,
    });
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(48000);
    expect(wav.readUInt32LE(40)).toBe(4);
    expect(wav.subarray(44)).toEqual(Buffer.from([1, 2, 3, 4]));
  });
});
