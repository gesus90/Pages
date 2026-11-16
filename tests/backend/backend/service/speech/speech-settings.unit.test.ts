import { describe, expect, it, vi } from "vitest";

import { SpeechSettingsService } from "@/backend/service/speech/SpeechSettingsService";
import {
  SPEECH_SIMULATION_CONNECTION,
  SPEECH_SIMULATION_MODEL,
} from "@/backend/service/speech/SpeechSimulation";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { SpeechSettingsDependencies } from "@/backend/service/speech/SpeechSettingsService";
import type { AccountAccess } from "@/definition/Authorization";

const actor = partial<AccountAccess>({
  userId: "u",
  isAdmin: true,
  isActive: true,
  mode: "admin",
});
const selection = {
  connectionId: SPEECH_SIMULATION_CONNECTION,
  model: SPEECH_SIMULATION_MODEL,
};

function fixture(): {
  service: SpeechSettingsService;
  read: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
} {
  const read = vi
    .fn()
    .mockResolvedValue({ selection: null, maxDurationMs: 60000, revision: 1 });
  const save = vi.fn().mockResolvedValue(undefined);
  const dependencies = partial<SpeechSettingsDependencies>({
    settings: partial({ read, save }),
    connections: partial({
      list: vi.fn().mockResolvedValue([]),
      find: vi.fn().mockResolvedValue(null),
    }),
    groups: { findIdsByMember: vi.fn().mockResolvedValue([]) },
    simulation: { isActive: true, scenario: "short_limit" },
  });
  return { service: new SpeechSettingsService(dependencies), read, save };
}

describe("speech recognition settings", () => {
  it("reports model availability and applies the model duration limit", async () => {
    const { service, read } = fixture();
    await expect(service.administration(actor)).resolves.toMatchObject({
      status: "noModel",
      isSimulation: true,
    });
    await expect(service.configuration()).resolves.toBeNull();
    read.mockResolvedValue({ selection, maxDurationMs: 60000, revision: 1 });
    await expect(service.configuration()).resolves.toMatchObject({
      maxDurationMs: 30000,
    });
    await expect(service.administration(actor)).resolves.toMatchObject({
      status: "ready",
      effectiveMaxDurationMs: 30000,
    });
    read.mockResolvedValue({
      selection: { connectionId: "missing", model: "missing" },
      maxDurationMs: 60000,
      revision: 1,
    });
    await expect(service.administration(actor)).resolves.toMatchObject({
      status: "modelUnavailable",
    });
    await expect(service.configuration()).resolves.toBeNull();
  });

  it("requires administrator rights and a valid duration and model", async () => {
    const { service, save } = fixture();
    await expect(
      service.save(
        { ...actor, isAdmin: false },
        { selection: null, maxDurationMs: 60000, revision: 1 },
      ),
    ).rejects.toThrow();
    await expect(
      service.save(actor, { selection: null, maxDurationMs: 1, revision: 1 }),
    ).rejects.toThrow();
    await expect(
      service.save(actor, {
        selection: { connectionId: "missing", model: "missing" },
        maxDurationMs: 60000,
        revision: 1,
      }),
    ).rejects.toThrow();
    await service.save(actor, { selection, maxDurationMs: 60000, revision: 1 });
    expect(save).toHaveBeenCalledWith({
      selection,
      maxDurationMs: 60000,
      revision: 1,
    });
  });
});
