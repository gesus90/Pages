import { beforeEach, expect, it, vi } from "vitest";

import { createSpeechServices } from "@/app/lib/speech-services.server";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { SpeechSettingsRepository } from "@/backend/database/repositories/speech/SpeechSettingsRepository";
import { SpeechProviderClient } from "@/backend/service/speech/SpeechProviderClient";
import { SpeechRecognitionService } from "@/backend/service/speech/SpeechRecognitionService";
import { SpeechSettingsService } from "@/backend/service/speech/SpeechSettingsService";
import { currentSpeechSimulationMode } from "@/backend/service/speech/SpeechSimulation";

import type { Database } from "@/backend/database/Database";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { SpeechSimulationMode } from "@/backend/service/speech/SpeechSimulation";

const { fakeClasses, opaque } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("@/backend/database/repositories/UserGroupRepository", () =>
  fakeClasses({ UserGroupRepository: [] }),
);
vi.mock("@/backend/database/repositories/speech/SpeechSettingsRepository", () =>
  fakeClasses({ SpeechSettingsRepository: [] }),
);
vi.mock("@/backend/service/speech/SpeechProviderClient", () =>
  fakeClasses({ SpeechProviderClient: [] }),
);
vi.mock("@/backend/service/speech/SpeechSettingsService", () =>
  fakeClasses({ SpeechSettingsService: [] }),
);
vi.mock("@/backend/service/speech/SpeechRecognitionService", () =>
  fakeClasses({ SpeechRecognitionService: [] }),
);
vi.mock("@/backend/service/speech/SpeechSimulation", () => ({
  currentSpeechSimulationMode: vi.fn(),
}));

const DATABASE = opaque<Database>("database");
const CONNECTIONS = opaque<AgentConnectionRepository>("connections");
const CIPHER = opaque<InstanceSecretCipher>("cipher");
const SIMULATION: SpeechSimulationMode = { isActive: false, scenario: "ok" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(currentSpeechSimulationMode).mockReturnValue(SIMULATION);
});

it("wires speech settings and recognition with stored connections and cipher", () => {
  const services = createSpeechServices({
    database: DATABASE,
    connections: CONNECTIONS,
    cipher: CIPHER,
  });

  const [settingsRepo] = vi.mocked(SpeechSettingsRepository).mock.instances;
  const [groupsRepo] = vi.mocked(UserGroupRepository).mock.instances;
  const [settingsService] = vi.mocked(SpeechSettingsService).mock.instances;
  const [recognitionService] = vi.mocked(SpeechRecognitionService).mock
    .instances;
  const [client] = vi.mocked(SpeechProviderClient).mock.instances;

  expect(vi.mocked(SpeechSettingsRepository).mock.calls[0]).toEqual([DATABASE]);
  expect(vi.mocked(UserGroupRepository).mock.calls[0]).toEqual([DATABASE]);
  expect(vi.mocked(SpeechSettingsService).mock.calls[0][0]).toEqual({
    settings: settingsRepo,
    connections: CONNECTIONS,
    groups: groupsRepo,
    simulation: SIMULATION,
  });
  expect(vi.mocked(SpeechRecognitionService).mock.calls[0][0]).toEqual({
    settings: settingsService,
    connections: CONNECTIONS,
    cipher: CIPHER,
    client,
    simulation: SIMULATION,
  });
  expect(services.speechSettingsService).toBe(settingsService);
  expect(services.speechRecognitionService).toBe(recognitionService);
});
