import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { SpeechModelSource } from "@/backend/service/speech/SpeechModels";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/backend/service/agents/AgentConnectionAccess", () => ({
  canUseAgentConnection: access,
}));

import {
  findSpeechModel,
  listSpeechModels,
  unlistedSpeechModelStatus,
} from "@/backend/service/speech/SpeechModels";

const router = {
  id: "router",
  name: "Router",
  provider: "openrouter",
  isActive: true,
  hasApiKey: true,
};
const zai = {
  id: "zai",
  name: "ZAI",
  provider: "zai",
  isActive: true,
  hasApiKey: true,
};
const transcription = {
  id: "speech",
  name: "Speech",
  inputModalities: ["audio"],
  outputModalities: ["transcription"],
  reasoning: "none",
  reasoningEfforts: [],
  defaultReasoningEffort: null,
  promptPrice: null,
  completionPrice: null,
  isFree: false,
};
const chat = { ...transcription, id: "chat", outputModalities: ["text"] };
const find = vi.fn();
const catalog = vi.fn();
const source = partial<SpeechModelSource>({
  connections: {
    list: async () => [
      router,
      zai,
      { ...router, id: "disabled", isActive: false },
    ],
    find,
    catalogs: () => ({ find: catalog }),
  },
  simulation: { isActive: true, scenario: "short_limit" },
});
const viewer = partial<AgentViewer>({});

beforeEach(() => {
  vi.resetAllMocks();
  access.mockResolvedValue(true);
  find.mockResolvedValue(router);
  catalog.mockResolvedValue({ models: [transcription, chat], errorCode: null });
});

it("lists transcription models, ZAI and the enabled simulation only", async () => {
  const models = await listSpeechModels(source, null);
  expect(models.map((entry) => entry.choice.model)).toEqual([
    "speech",
    "glm-asr-2512",
    expect.any(String),
  ]);
  expect(models[1].limitMs).toBe(30_000);
  expect(models[2].choice.isSimulation).toBe(true);
  expect(models[2].limitMs).not.toBeNull();
  expect(
    findSpeechModel(models, { connectionId: "router", model: "speech" }),
  ).toBe(models[0]);
  expect(findSpeechModel(models, null)).toBeNull();
  expect(
    findSpeechModel(models, { connectionId: "router", model: "missing" }),
  ).toBeNull();
});

it("filters connections outside a viewer's scope and marks failed catalogs", async () => {
  access.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  catalog.mockResolvedValue({ models: [transcription], errorCode: "failed" });
  const models = await listSpeechModels(source, viewer);
  expect(models[0].choice.isCatalogFailed).toBe(true);
  expect(models.some((entry) => entry.choice.model === "glm-asr-2512")).toBe(
    false,
  );
});

it("explains why a saved speech model is unavailable", async () => {
  expect(
    await unlistedSpeechModelStatus(source, viewer, {
      connectionId: "router",
      model: "chat",
    }),
  ).toBe("modelUnsuitable");
  expect(
    await unlistedSpeechModelStatus(source, viewer, {
      connectionId: "router",
      model: "missing",
    }),
  ).toBe("modelNotInCatalog");
  expect(
    await unlistedSpeechModelStatus(source, viewer, {
      connectionId: "router",
      model: "speech",
    }),
  ).toBe("modelUnavailable");
  access.mockResolvedValue(false);
  expect(
    await unlistedSpeechModelStatus(source, viewer, {
      connectionId: "router",
      model: "chat",
    }),
  ).toBe("modelUnavailable");
  find.mockResolvedValue(null);
  expect(
    await unlistedSpeechModelStatus(source, viewer, {
      connectionId: "gone",
      model: "chat",
    }),
  ).toBe("modelUnavailable");
});
