import { beforeEach, expect, it, vi } from "vitest";

import {
  AgentCatalogRefresh,
  nextCatalogRefresh,
} from "@/backend/service/agents/AgentCatalogRefresh";

import { partial } from "../../../app/lib/service-wiring-fakes";

const find = vi.fn();
const findSecretEncrypted = vi.fn();
const findCatalog = vi.fn();
const save = vi.fn();
const list = vi.fn();
const transcription = vi.fn();
const speech = vi.fn();
const decision = vi.fn();
const cli = vi.fn();
const service = new AgentCatalogRefresh(
  partial<ConstructorParameters<typeof AgentCatalogRefresh>[0]>({
    repository: {
      find,
      findSecretEncrypted,
      catalogs: () => ({ find: findCatalog, save }),
    },
    cipher: { decrypt: () => "key" },
    client: {
      list,
      addTranscriptionModels: transcription,
      addSpeechOutputModels: speech,
      addDecisionModels: decision,
    },
    cli: { listModels: cli },
    operations: {
      run: async (id: string, kind: string, work: () => Promise<unknown>) => {
        expect(id).toBe("connection");
        expect(kind).toBe("check");
        return work();
      },
    },
    now: () => 0,
  }),
);
const connection = {
  id: "connection",
  provider: "openrouter",
  testModel: "existing",
};

beforeEach(() => {
  vi.resetAllMocks();
  find.mockResolvedValue(connection);
  findSecretEncrypted.mockResolvedValue("encrypted");
  findCatalog.mockResolvedValue({ intervalHours: 24, models: [] });
  list.mockResolvedValue([]);
  transcription.mockResolvedValue([]);
  speech.mockResolvedValue([]);
  decision.mockResolvedValue([]);
});

it("refreshes API catalog families and schedules the next attempt", async () => {
  await service.run("connection");
  expect(list).toHaveBeenCalledWith(
    "openrouter",
    "key",
    expect.any(AbortSignal),
    undefined,
  );
  expect(transcription).toHaveBeenCalledOnce();
  expect(speech).toHaveBeenCalledOnce();
  expect(decision).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith(
    "connection",
    { models: [], errorCode: null, attemptedAt: "1970-01-01T00:00:00.000Z" },
    "1970-01-02T00:00:00.000Z",
  );
  expect(nextCatalogRefresh(0, 0)).toBeNull();
});

it("records provider failures without replacing the previous catalog", async () => {
  list.mockRejectedValueOnce(new Error("offline"));
  await service.run("connection");
  expect(save).toHaveBeenCalledWith(
    "connection",
    expect.objectContaining({
      models: null,
      errorCode: "provider_unreachable",
    }),
    expect.any(String),
  );
});

it("uses the CLI catalog for native connections", async () => {
  find.mockResolvedValue({ ...connection, provider: "codex_cli" });
  cli.mockResolvedValue([]);
  await service.run("connection");
  expect(cli).toHaveBeenCalledOnce();
  expect(list).not.toHaveBeenCalled();
});
