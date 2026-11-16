import { expect, it } from "vitest";

import { inspectSpeechAudio } from "@/backend/service/speech/SpeechAudio";

function wav(dataSize: number, declaredSize: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt32LE(8000, 28);
  header.write("data", 36);
  header.writeUInt32LE(declaredSize, 40);
  return Buffer.concat([header, Buffer.alloc(dataSize)]);
}

it("derives WAV duration from data bytes and byte rate, including streaming sizes", () => {
  expect(inspectSpeechAudio(wav(8000, 8000), "audio/wav")).toEqual({
    durationMs: 1000,
  });
  expect(inspectSpeechAudio(wav(4000, 0), "audio/wav")).toEqual({
    durationMs: 500,
  });
  expect(inspectSpeechAudio(wav(4000, 9000), "audio/wav")).toEqual({
    durationMs: 500,
  });
  expect(inspectSpeechAudio(Buffer.from("not wave"), "audio/wav")).toBeNull();
  const missingRate = wav(10, 10);
  missingRate.writeUInt32LE(0, 28);
  expect(inspectSpeechAudio(missingRate, "audio/wav")).toBeNull();
});

it("reads MPEG frames after an optional ID3 header and refuses invalid data", () => {
  const frame = Buffer.alloc(417);
  Buffer.from([0xff, 0xfb, 0x90, 0]).copy(frame);
  expect(inspectSpeechAudio(frame, "audio/mpeg")).toEqual({ durationMs: 27 });
  expect(
    inspectSpeechAudio(Buffer.concat([frame, frame]), "audio/mpeg"),
  ).toEqual({ durationMs: 53 });
  const id3 = Buffer.alloc(10);
  id3.write("ID3");
  expect(inspectSpeechAudio(Buffer.concat([id3, frame]), "audio/mpeg")).toEqual(
    { durationMs: 27 },
  );
  expect(inspectSpeechAudio(Buffer.from("invalid"), "audio/mpeg")).toBeNull();
});
