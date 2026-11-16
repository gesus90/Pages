import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { createConversationTranscriber } from "@/backend/service/conversation/ConversationTranscriber";
import { ConversationProviderTranscriber } from "@/backend/service/conversation/ConversationProviderTranscriber";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

const input = {
  open: () => Readable.from([Buffer.from("abc"), "é"]),
  mimeType: "audio/wav",
  sizeBytes: 5,
};

describe("conversation transcription selection", () => {
  it("counts audio bytes in simulation, including a fallback scenario", async () => {
    for (const scenario of ["ok", "unknown"]) {
      const transcriber = createConversationTranscriber({
        environment: {
          PAGES_STT_SIMULATION: "1",
          PAGES_STT_SIMULATION_SCENARIO: scenario,
        },
      });
      await expect(transcriber.transcribe(input)).resolves.toEqual({
        ok: true,
        text: "Simulierte Spracherkennung: 5 Bytes empfangen.",
      });
    }
  });

  it("returns failure for simulated provider and stream errors", async () => {
    const failed = createConversationTranscriber({
      environment: {
        PAGES_STT_SIMULATION: "1",
        PAGES_STT_SIMULATION_SCENARIO: "provider_failed",
      },
    });
    await expect(failed.transcribe(input)).resolves.toEqual({ ok: false });
    const simulated = createConversationTranscriber({
      environment: { PAGES_STT_SIMULATION: "1" },
    });
    await expect(
      simulated.transcribe({
        ...input,
        open: () => {
          throw new Error("read failed");
        },
      }),
    ).resolves.toEqual({ ok: false });
  });

  it("requires both configured model and endpoint and ignores simulation in production", async () => {
    for (const speech of [
      undefined,
      { model: "m" },
      { url: "https://example.test" },
    ]) {
      const transcriber = createConversationTranscriber({
        speech,
        environment: { NODE_ENV: "production", PAGES_STT_SIMULATION: "1" },
      });
      await expect(transcriber.transcribe(input)).resolves.toEqual({
        ok: false,
      });
    }
    expect(
      createConversationTranscriber({
        speech: { model: "m", url: "https://example.test" },
        environment: {},
      }),
    ).toBeInstanceOf(ConversationProviderTranscriber);
  });
});
