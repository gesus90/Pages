import { describe, expect, it, vi } from "vitest";

import { SpeechSynthesisSettingsService } from "@/backend/service/speech/SpeechSynthesisSettingsService";
import {
  SPEECH_SYNTHESIS_SIMULATION_CONNECTION,
  SPEECH_SYNTHESIS_SIMULATION_MODEL,
} from "@/backend/service/speech/SpeechSynthesisSimulation";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { SpeechSynthesisSettingsDependencies } from "@/backend/service/speech/SpeechSynthesisSettingsService";
import type { AccountAccess } from "@/definition/Authorization";

const actor = partial<AccountAccess>({
  userId: "u",
  isAdmin: true,
  isActive: true,
  mode: "admin",
});
const selection = {
  connectionId: SPEECH_SYNTHESIS_SIMULATION_CONNECTION,
  model: SPEECH_SYNTHESIS_SIMULATION_MODEL,
};

function fixture(): {
  service: SpeechSynthesisSettingsService;
  read: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
} {
  const read = vi
    .fn()
    .mockResolvedValue({ selection: null, maxDurationMs: 30000, revision: 1 });
  const save = vi.fn().mockResolvedValue(undefined);
  const dependencies = partial<SpeechSynthesisSettingsDependencies>({
    settings: partial({ read, save }),
    connections: partial({ list: vi.fn().mockResolvedValue([]) }),
    groups: { findIdsByMember: vi.fn().mockResolvedValue([]) },
    simulation: { isActive: true, scenario: "ok" },
  });
  return {
    service: new SpeechSynthesisSettingsService(dependencies),
    read,
    save,
  };
}

describe("speech synthesis settings", () => {
  it("reports absent and available simulation models", async () => {
    const { service, read } = fixture();
    await expect(service.administration(actor)).resolves.toMatchObject({
      status: "noModel",
      isSimulation: true,
    });
    await expect(service.configuration()).resolves.toBeNull();
    read.mockResolvedValue({ selection, maxDurationMs: 30000, revision: 1 });
    await expect(service.configuration()).resolves.toMatchObject({
      maxDurationMs: 30000,
      model: { choice: { model: SPEECH_SYNTHESIS_SIMULATION_MODEL } },
    });
    await expect(service.voiceOptions()).resolves.toMatchObject({
      status: "ready",
      model: { connectionId: SPEECH_SYNTHESIS_SIMULATION_CONNECTION },
    });
  });

  it("validates administrators, duration and available model before saving", async () => {
    const { service, save } = fixture();
    await expect(
      service.save(
        { ...actor, isAdmin: false },
        { selection: null, maxDurationMs: 30000, revision: 1 },
      ),
    ).rejects.toThrow();
    await expect(
      service.save(actor, { selection: null, maxDurationMs: 1, revision: 1 }),
    ).rejects.toThrow();
    await expect(
      service.save(actor, {
        selection: { connectionId: "missing", model: "missing" },
        maxDurationMs: 30000,
        revision: 1,
      }),
    ).rejects.toThrow();
    await service.save(actor, { selection, maxDurationMs: 30000, revision: 1 });
    expect(save).toHaveBeenCalledWith({
      selection,
      maxDurationMs: 30000,
      revision: 1,
    });
  });

  it("reports unavailable saved models", async () => {
    const { service, read } = fixture();
    read.mockResolvedValue({
      selection: { connectionId: "missing", model: "missing" },
      maxDurationMs: 30000,
      revision: 1,
    });
    await expect(service.administration(actor)).resolves.toMatchObject({
      status: "modelUnavailable",
    });
    await expect(service.configuration()).resolves.toBeNull();
    await expect(service.voiceOptions()).resolves.toEqual({
      status: "modelUnavailable",
      model: null,
    });
  });
});
