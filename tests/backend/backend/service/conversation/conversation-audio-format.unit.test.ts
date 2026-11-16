import { expect, it } from "vitest";

import {
  readAudioFacts,
  readVoiceFormat,
  voiceMimeType,
} from "@/backend/service/conversation/ConversationAudioFormat";

function wave(byteRate: number, dataLength: number): Buffer {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt32LE(byteRate, 28);
  head.write("data", 36);
  head.writeUInt32LE(dataLength, 40);
  return head;
}

it("normalizes supported MIME declarations and emits canonical types", () => {
  expect(readVoiceFormat(" Audio/WAV; codecs=pcm ")).toBe("wav");
  expect(readVoiceFormat("audio/mpeg")).toBe("mp3");
  expect(readVoiceFormat("text/plain")).toBeNull();
  expect(voiceMimeType("wav")).toBe("audio/wav");
  expect(voiceMimeType("mp3")).toBe("audio/mpeg");
});

it("calculates WAV duration from bounded data and byte rate", () => {
  expect(readAudioFacts(wave(1000, 2000), 2044)).toEqual({
    format: "wav",
    durationMs: 2000,
  });
  expect(readAudioFacts(wave(1000, 0xffffffff), 544)).toEqual({
    format: "wav",
    durationMs: 500,
  });
  expect(readAudioFacts(wave(0, 100), 144)).toEqual({
    format: "wav",
    durationMs: null,
  });
  const missingFormat = wave(1000, 100);
  missingFormat.write("junk", 12);
  expect(readAudioFacts(missingFormat, 144)).toEqual({
    format: "wav",
    durationMs: null,
  });
});

it("recognizes MP3 tags and layer III frames but rejects other data", () => {
  expect(readAudioFacts(Buffer.from("ID3tag"), 6)).toEqual({
    format: "mp3",
    durationMs: null,
  });
  expect(readAudioFacts(Buffer.from([0xff, 0xfb]), 2)).toEqual({
    format: "mp3",
    durationMs: null,
  });
  expect(readAudioFacts(Buffer.from([0xff, 0xeb]), 2)).toBeNull();
  expect(readAudioFacts(Buffer.from([0xff]), 1)).toBeNull();
  expect(readAudioFacts(Buffer.from("RIFFshort"), 9)).toBeNull();
});
