import { expect, it, vi } from "vitest";

import { SpeechRecognitionService } from "@/backend/service/speech/SpeechRecognitionService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { SpeechRecognitionDependencies } from "@/backend/service/speech/SpeechRecognitionService";

function wav(): Buffer {
  const bytes = Buffer.alloc(8044);
  bytes.write("RIFF", 0);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt32LE(8000, 28);
  bytes.write("data", 36);
  bytes.writeUInt32LE(8000, 40);
  return bytes;
}

it("clears audio even when recognition is not configured", async () => {
  const audio = Buffer.from("private");
  const service = new SpeechRecognitionService(
    partial<SpeechRecognitionDependencies>({
      settings: { configuration: async () => null },
    }),
  );
  await expect(
    service.transcribe({
      audio,
      mimeType: "audio/wav",
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual({ ok: false, code: "not_configured" });
  expect(audio.equals(Buffer.alloc(audio.length))).toBe(true);
  await expect(service.limits()).resolves.toBeNull();
});

it("uses simulation without a provider and enforces audio duration", async () => {
  const transcribe = vi.fn();
  const dependencies = partial<SpeechRecognitionDependencies>({
    settings: { configuration: async () => ({ maxDurationMs: 1000 }) },
    simulation: { isActive: true, scenario: "ok" },
    client: { transcribe },
  });
  const service = new SpeechRecognitionService(dependencies);
  const audio = wav();
  await expect(
    service.transcribe({
      audio,
      mimeType: "audio/wav",
      signal: new AbortController().signal,
    }),
  ).resolves.toMatchObject({ ok: true });
  expect(audio.equals(Buffer.alloc(audio.length))).toBe(true);
  expect(transcribe).not.toHaveBeenCalled();
  const strict = new SpeechRecognitionService(
    partial<SpeechRecognitionDependencies>({
      ...dependencies,
      settings: { configuration: async () => ({ maxDurationMs: 999 }) },
    }),
  );
  await expect(
    strict.transcribe({
      audio: wav(),
      mimeType: "audio/wav",
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual({ ok: false, code: "too_long" });
});
