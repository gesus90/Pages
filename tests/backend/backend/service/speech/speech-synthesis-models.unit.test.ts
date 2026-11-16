import { expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { SpeechSynthesisModelSource } from "@/backend/service/speech/SpeechSynthesisModels";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/backend/service/agents/AgentConnectionAccess", () => ({
  canUseAgentConnection: access,
}));

import {
  findSpeechSynthesisModel,
  listSpeechSynthesisModels,
} from "@/backend/service/speech/SpeechSynthesisModels";

const connection = {
  id: "router",
  name: "Router",
  provider: "openrouter",
  isActive: true,
  hasApiKey: true,
};
const model = {
  id: "speech",
  name: "Speech",
  outputModalities: ["speech"],
  supportedVoices: ["voice"],
  reasoning: "none",
  reasoningEfforts: [],
  defaultReasoningEffort: null,
  promptPrice: null,
  completionPrice: null,
  isFree: false,
};
const catalog = vi.fn(async () => ({
  models: [model, { ...model, id: "chat", outputModalities: ["text"] }],
  errorCode: null,
}));
const source = partial<SpeechSynthesisModelSource>({
  connections: {
    list: async () => [
      connection,
      { ...connection, id: "disabled", isActive: false },
    ],
    catalogs: () => ({ find: catalog }),
  },
  simulation: { isActive: true, scenario: "no_voices" },
});

it("lists only speech output models and the enabled simulation", async () => {
  const models = await listSpeechSynthesisModels(source, null);
  expect(models).toHaveLength(2);
  expect(models[0]).toMatchObject({
    choice: { model: "speech", isSpeechOutputCapable: true },
    voices: ["voice"],
  });
  expect(models[1]).toMatchObject({
    choice: { isSimulation: true },
    voices: null,
  });
  expect(
    findSpeechSynthesisModel(models, {
      connectionId: "router",
      model: "speech",
    }),
  ).toBe(models[0]);
  expect(findSpeechSynthesisModel(models, null)).toBeNull();
});

it("honors viewer scope without consulting inaccessible catalogs", async () => {
  catalog.mockClear();
  access.mockResolvedValue(false);
  const models = await listSpeechSynthesisModels(
    source,
    partial<AgentViewer>({}),
  );
  expect(models).toHaveLength(1);
  expect(models[0].choice.isSimulation).toBe(true);
  expect(catalog).not.toHaveBeenCalled();
});
