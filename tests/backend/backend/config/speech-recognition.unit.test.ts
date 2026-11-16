import { describe, expect, it } from "vitest";

import {
  readSpeechRecognitionConfig,
  voiceMaximumDurationMs,
} from "@/backend/config/SpeechRecognitionConfig";

describe("speech recognition configuration", () => {
  it("reads and normalizes the optional configuration", () => {
    expect(readSpeechRecognitionConfig({})).toEqual({});
    expect(
      readSpeechRecognitionConfig({
        speechRecognition: {
          model: " whisper ",
          url: "https://example.test/audio",
          apiKeyFile: "/keys/../keys/token",
          maximumRecordingSeconds: 12,
        },
      }),
    ).toEqual({
      speechRecognition: {
        model: "whisper",
        url: "https://example.test/audio",
        apiKeyFile: "/keys/token",
        maximumRecordingSeconds: 12,
      },
    });
    expect(voiceMaximumDurationMs(undefined)).toBe(300000);
    expect(voiceMaximumDurationMs({ maximumRecordingSeconds: 12 })).toBe(12000);
  });

  it("rejects malformed tables and model names", () => {
    for (const speechRecognition of [null, [], "bad", new Date()]) {
      expect(() => readSpeechRecognitionConfig({ speechRecognition })).toThrow(
        "must be a table",
      );
    }
    for (const model of [" ", 12]) {
      expect(() =>
        readSpeechRecognitionConfig({ speechRecognition: { model } }),
      ).toThrow("model name");
    }
  });

  it("rejects unsafe endpoints, key paths, and invalid recording limits", () => {
    for (const url of [
      "bad",
      "file:///secret",
      "https://user:pass@example.test",
      2,
    ]) {
      expect(() =>
        readSpeechRecognitionConfig({ speechRecognition: { url } }),
      ).toThrow("http or https");
    }
    for (const apiKeyFile of ["relative", 2]) {
      expect(() =>
        readSpeechRecognitionConfig({ speechRecognition: { apiKeyFile } }),
      ).toThrow("absolute file path");
    }
    for (const maximumRecordingSeconds of [0, 3601, 1.5, "12"]) {
      expect(() =>
        readSpeechRecognitionConfig({
          speechRecognition: { maximumRecordingSeconds },
        }),
      ).toThrow("whole number");
    }
  });
});
