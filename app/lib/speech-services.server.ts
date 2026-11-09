import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { SpeechSettingsRepository } from "@/backend/database/repositories/speech/SpeechSettingsRepository";
import { SpeechProviderClient } from "@/backend/service/speech/SpeechProviderClient";
import { SpeechRecognitionService } from "@/backend/service/speech/SpeechRecognitionService";
import { SpeechSettingsService } from "@/backend/service/speech/SpeechSettingsService";
import { currentSpeechSimulationMode } from "@/backend/service/speech/SpeechSimulation";

import type { Database } from "@/backend/database/Database";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

/** The speech recognition of the instance (PAGE-273). */
export interface SpeechApplicationServices {
  readonly speechSettingsService: SpeechSettingsService;
  readonly speechRecognitionService: SpeechRecognitionService;
}

/**
 * Wires the speech recognition setting and the recognition with the stored
 * connections and their keys.
 *
 * @param input - The database, the connections and the cipher of their keys.
 * @returns Both services; the simulation switch is read once per process.
 */
export function createSpeechServices(input: {
  readonly database: Database;
  readonly connections: AgentConnectionRepository;
  readonly cipher: InstanceSecretCipher;
}): SpeechApplicationServices {
  const simulation = currentSpeechSimulationMode();
  const speechSettingsService = new SpeechSettingsService({
    settings: new SpeechSettingsRepository(input.database),
    connections: input.connections,
    groups: new UserGroupRepository(input.database),
    simulation,
  });
  return {
    speechSettingsService,
    speechRecognitionService: new SpeechRecognitionService({
      settings: speechSettingsService,
      connections: input.connections,
      cipher: input.cipher,
      client: new SpeechProviderClient(),
      simulation,
    }),
  };
}
