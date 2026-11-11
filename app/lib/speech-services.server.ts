import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { SpeechSettingsRepository } from "@/backend/database/repositories/speech/SpeechSettingsRepository";
import { SpeechSynthesisSettingsRepository } from "@/backend/database/repositories/speech/SpeechSynthesisSettingsRepository";
import { SpeechProviderClient } from "@/backend/service/speech/SpeechProviderClient";
import { SpeechRecognitionService } from "@/backend/service/speech/SpeechRecognitionService";
import { SpeechSettingsService } from "@/backend/service/speech/SpeechSettingsService";
import { currentSpeechSimulationMode } from "@/backend/service/speech/SpeechSimulation";
import { SpeechSynthesisClient } from "@/backend/service/speech/SpeechSynthesisClient";
import { SpeechSynthesisPreviewService } from "@/backend/service/speech/SpeechSynthesisPreviewService";
import { SpeechSynthesisSettingsService } from "@/backend/service/speech/SpeechSynthesisSettingsService";
import { currentSpeechSynthesisSimulationMode } from "@/backend/service/speech/SpeechSynthesisSimulation";

import type { Database } from "@/backend/database/Database";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

/** The speech recognition (PAGE-273) and the speech output (PAGE-300) of the instance. */
export interface SpeechApplicationServices {
  readonly speechSettingsService: SpeechSettingsService;
  readonly speechRecognitionService: SpeechRecognitionService;
  readonly speechSynthesisSettingsService: SpeechSynthesisSettingsService;
  readonly speechSynthesisPreviewService: SpeechSynthesisPreviewService;
}

function createSpeechSynthesisServices(input: {
  readonly database: Database;
  readonly connections: AgentConnectionRepository;
  readonly cipher: InstanceSecretCipher;
}): Pick<
  SpeechApplicationServices,
  "speechSynthesisSettingsService" | "speechSynthesisPreviewService"
> {
  const simulation = currentSpeechSynthesisSimulationMode();
  const speechSynthesisSettingsService = new SpeechSynthesisSettingsService({
    settings: new SpeechSynthesisSettingsRepository(input.database),
    connections: input.connections,
    groups: new UserGroupRepository(input.database),
    simulation,
  });
  return {
    speechSynthesisSettingsService,
    speechSynthesisPreviewService: new SpeechSynthesisPreviewService({
      settings: speechSynthesisSettingsService,
      connections: input.connections,
      cipher: input.cipher,
      client: new SpeechSynthesisClient(),
      simulation,
    }),
  };
}

/**
 * Wires the speech recognition and the speech output with the stored
 * connections and their keys.
 *
 * @param input - The database, the connections and the cipher of their keys.
 * @returns The services; each simulation switch is read once per process.
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
    ...createSpeechSynthesisServices(input),
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
