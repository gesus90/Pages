import { describe, expect, it, vi } from "vitest";

import { SpeechSynthesisPreviewService } from "@/backend/service/speech/SpeechSynthesisPreviewService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { SpeechSynthesisModelEntry } from "@/backend/service/speech/SpeechSynthesisModels";
import type { SpeechSynthesisPreviewDependencies } from "@/backend/service/speech/SpeechSynthesisPreviewService";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const input = {
  agentName: "Ada",
  voiceId: null,
  speedTenths: 12,
  language: "en" as const,
  signal: new AbortController().signal,
};
const model = partial<SpeechSynthesisModelEntry>({
  choice: partial({ connectionId: "c", model: "voice" }),
  connection: partial({ id: "c" }),
  voices: ["alloy"],
});

function fixture(): {
  service: SpeechSynthesisPreviewService;
  configuration: ReturnType<typeof vi.fn>;
  secret: ReturnType<typeof vi.fn>;
  decrypt: ReturnType<typeof vi.fn>;
  synthesize: ReturnType<typeof vi.fn>;
} {
  const configuration = vi
    .fn()
    .mockResolvedValue({ model, maxDurationMs: 10000 });
  const secret = vi.fn().mockResolvedValue("encrypted");
  const decrypt = vi.fn().mockReturnValue("token");
  const synthesize = vi.fn().mockResolvedValue({
    ok: true,
    audio: Buffer.from("audio"),
    mimeType: "audio/wav",
    isSpeedApplied: false,
  });
  const dependencies: SpeechSynthesisPreviewDependencies = {
    settings: { configuration },
    connections: { findSecretEncrypted: secret },
    cipher: { decrypt },
    client: { synthesize },
    simulation: { isActive: false, scenario: "ok" },
  };
  return {
    service: new SpeechSynthesisPreviewService(dependencies),
    configuration,
    secret,
    decrypt,
    synthesize,
  };
}

describe("speech synthesis preview", () => {
  it("caches successful audio and falls back to playback speed", async () => {
    const { service, synthesize } = fixture();
    await expect(service.preview(input)).resolves.toMatchObject({
      ok: true,
      sample: { playbackRate: 1.2, audio: Buffer.from("audio") },
    });
    await service.preview(input);
    expect(synthesize).toHaveBeenCalledTimes(1);
    await service.preview({ ...input, agentName: "Grace" });
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("returns configuration and provider failures without caching", async () => {
    const { service, configuration, secret, decrypt, synthesize } = fixture();
    configuration.mockResolvedValueOnce(null);
    await expect(service.preview(input)).resolves.toEqual({
      ok: false,
      code: "not_configured",
    });
    secret.mockResolvedValueOnce(null);
    await expect(service.preview(input)).resolves.toEqual({
      ok: false,
      code: "not_configured",
    });
    decrypt.mockImplementationOnce(() => {
      throw new Error("invalid key");
    });
    await expect(service.preview(input)).resolves.toEqual({
      ok: false,
      code: "not_configured",
    });
    synthesize
      .mockResolvedValueOnce({ ok: false, code: "provider_failed" })
      .mockResolvedValueOnce({
        ok: true,
        audio: Buffer.from("a"),
        mimeType: "audio/wav",
        isSpeedApplied: true,
      });
    await expect(service.preview(input)).resolves.toEqual({
      ok: false,
      code: "provider_failed",
    });
    await expect(service.preview(input)).resolves.toMatchObject({
      ok: true,
      sample: { playbackRate: 1 },
    });
  });

  it("generates simulated samples without contacting a provider", async () => {
    const { service, configuration, synthesize } = fixture();
    configuration.mockResolvedValue({
      model: { ...model, connection: null },
      maxDurationMs: 10000,
    });
    await expect(service.preview(input)).resolves.toMatchObject({
      ok: true,
      sample: { mimeType: "audio/wav" },
    });
    expect(synthesize).not.toHaveBeenCalled();
  });
});
