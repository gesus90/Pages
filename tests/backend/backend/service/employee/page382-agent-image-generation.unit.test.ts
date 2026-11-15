import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentImageError } from "@/backend/error/AgentImageError";
import { registerPicaEmployeeTools } from "@/backend/service/chat/PicaEmployeeTools";
import { ConversationGeneratedImages } from "@/backend/service/conversation/content/ConversationGeneratedImages";
import { AgentImageGeneration } from "@/backend/service/employee/AgentImageGeneration";
import { agentImageTool } from "@/backend/service/employee/AgentImageTool";
import { imageToolOf } from "@/backend/service/employee/AgentEmployeeChatTools";
import { isChatModel, isTextCapableModel } from "@/definition/AgentModelFilter";
import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { isImageOutputModel } from "@/definition/AgentImageGeneration";

import type { ProviderImageClient } from "@/backend/agents/providers/ProviderImageClients";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentImageGenerationDependencies } from "@/backend/service/employee/AgentImageGeneration";
import type { AgentImageToolDependencies } from "@/backend/service/employee/AgentImageTool";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { PageAgentModel } from "@/definition/PageAgent";

const KEY = "sk-or-secret-key-123";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function connection(
  overrides: Partial<AgentConnectionRecord> = {},
): AgentConnectionRecord {
  const record: AgentConnectionRecord = {
    id: "opencode-1",
    name: "OpenCode",
    provider: "opencode",
    isActive: true,
    hasApiKey: false,
    testModel: null,
    reasoningEffort: null,
    cliLoggedInAt: null,
    cliAccountLabel: null,
    updatedAt: "2026-11-14T00:00:00.000Z",
    ...overrides,
  };
  return record;
}

const OPENROUTER_LINK = connection({
  id: "openrouter-1",
  name: "OpenRouter",
  provider: "openrouter",
  hasApiKey: true,
});

function catalogModel(
  id: string,
  outputModalities?: readonly string[],
): AgentCatalogModel {
  return {
    id,
    name: id.split("/").at(-1) ?? id,
    contextWindow: null,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    reasoning: "unknown",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    ...(outputModalities ? { outputModalities } : {}),
  };
}

function imageChoice(): PageAgentModel {
  return {
    ...catalogModelChoice(
      { id: "openrouter-1", name: "OpenRouter", provider: "openrouter" },
      catalogModel("google/gemini-2.5-flash-image", ["text", "image"]),
    ),
    connectionName: "OpenRouter",
  };
}

function generation(
  options: {
    readonly models?: readonly AgentCatalogModel[];
    readonly isLinkVerified?: boolean;
    readonly client?: ProviderImageClient;
  } = {},
): {
  service: AgentImageGeneration;
  client: ProviderImageClient;
  record: ReturnType<typeof vi.fn>;
  decrypt: ReturnType<typeof vi.fn>;
} {
  const client: ProviderImageClient = options.client ?? {
    generate: vi.fn().mockResolvedValue({
      images: [{ mimeType: "image/png", bytes: PNG }],
      text: "",
      costUsd: 0.04,
    }),
  };
  const record = vi.fn().mockResolvedValue(undefined);
  const decrypt = vi.fn().mockReturnValue(KEY);
  const dependencies: AgentImageGenerationDependencies = {
    connections: {
      find: vi.fn(),
      findSecretEncrypted: vi.fn().mockResolvedValue("encrypted"),
      catalogs: () =>
        ({
          find: vi.fn().mockResolvedValue({
            models: options.models ?? [
              catalogModel("google/gemini-2.5-flash-image", ["text", "image"]),
              catalogModel("anthropic/claude-opus", ["text"]),
            ],
          }),
        }) as unknown as ReturnType<
          AgentImageGenerationDependencies["connections"]["catalogs"]
        >,
      list: vi.fn().mockResolvedValue([OPENROUTER_LINK]),
      checks: () =>
        ({
          find: vi.fn().mockResolvedValue({
            status: options.isLinkVerified === false ? "failed" : "passed",
          }),
        }) as unknown as ReturnType<
          AgentImageGenerationDependencies["connections"]["checks"]
        >,
    },
    cipher: { decrypt },
    models: { models: vi.fn().mockResolvedValue([imageChoice()]) },
    store: {
      activity: () =>
        ({ record }) as unknown as ReturnType<
          AgentImageGenerationDependencies["store"]["activity"]
        >,
    },
    clients: { openrouter: client, google_ai_studio: client },
  };
  return {
    service: new AgentImageGeneration(dependencies),
    client,
    record,
    decrypt,
  };
}

const employee = { userId: "agent-1", access: "read_only" as const };
const imageAssignment = {
  connection: OPENROUTER_LINK,
  model: "google/gemini-2.5-flash-image",
};
const textAssignment = {
  connection: connection({ id: "claude-1", provider: "claude_code" }),
  model: "claude-opus-5-5",
};

describe("which models generate images (PAGE-382)", () => {
  it("decides from the stated output modalities, never from the name", () => {
    expect(isImageOutputModel({ outputModalities: ["text", "image"] })).toBe(
      true,
    );
    expect(isImageOutputModel({ outputModalities: ["text"] })).toBe(false);
    expect(isImageOutputModel({})).toBe(false);
    expect(
      catalogModelChoice(
        { id: "c", name: "C", provider: "opencode" },
        catalogModel("openrouter/x/image-named-model", ["text"]),
      ).isImageOutputCapable,
    ).toBeUndefined();
  });

  it("keeps a model that answers in text beside images in the chat choice", () => {
    const choice = imageChoice();
    expect(choice.isImageOutputCapable).toBe(true);
    expect(choice.isChatCapable).toBeUndefined();
    expect(
      isTextCapableModel({ id: "m", outputModalities: ["text", "image"] }),
    ).toBe(true);
    expect(isTextCapableModel({ id: "m", outputModalities: ["image"] })).toBe(
      false,
    );
    expect(
      isChatModel({
        status: "active",
        output: { text: true, image: true },
        toolCall: true,
      }),
    ).toBe(true);
    expect(
      isChatModel({
        status: "active",
        output: { text: false, image: true },
        toolCall: true,
      }),
    ).toBe(false);
  });
});

describe("generating images with the model of the round (PAGE-382)", () => {
  it("can generate with an OpenCode model of OpenRouter that states image output", async () => {
    const { service } = generation();
    expect(
      await service.capability({ employee, assignment: imageAssignment }),
    ).toEqual({ canGenerate: true, modelName: "gemini-2.5-flash-image" });
  });

  it("names the released image models when the current model has no image output", async () => {
    const { service } = generation();
    const capability = await service.capability({
      employee,
      assignment: textAssignment,
    });
    expect(capability).toEqual({
      canGenerate: false,
      modelName: "claude-opus-5-5",
      reason: "no_image_output",
      alternatives: ["gemini-2.5-flash-image (OpenRouter)"],
    });
  });

  it("refuses without a verified key of the linked connection", async () => {
    const { service } = generation({ isLinkVerified: false });
    expect(
      await service.capability({
        employee,
        assignment: {
          ...imageAssignment,
          connection: connection({ ...OPENROUTER_LINK, hasApiKey: false }),
        },
      }),
    ).toMatchObject({ canGenerate: false, reason: "no_key" });
  });

  it("calls the provider once per image with the stored key and records the cost with the agent", async () => {
    const { service, client, record, decrypt } = generation();
    const result = await service.generate({
      employee,
      assignment: imageAssignment,
      prompt: "Ein Fuchs im Schnee",
      count: 2,
      aspectRatio: "16:9",
      templates: [],
      signal: new AbortController().signal,
    });
    expect(result.images).toHaveLength(2);
    expect(decrypt).toHaveBeenCalledWith("openrouter-1", "encrypted");
    expect(client.generate).toHaveBeenCalledTimes(2);
    expect(client.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: KEY,
        model: "google/gemini-2.5-flash-image",
        prompt: "Ein Fuchs im Schnee",
        aspectRatio: "16:9",
      }),
    );
    expect(record).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        kind: "image",
        cost: { state: "known", amount: 0.08, isEstimated: false },
      }),
    );
  });

  it("fails clearly when the model answers without an image", async () => {
    const { service } = generation({
      client: {
        generate: vi.fn().mockResolvedValue({
          images: [],
          text: "Das darf ich nicht zeichnen.",
          costUsd: null,
        }),
      },
    });
    await expect(
      service.generate({
        employee,
        assignment: imageAssignment,
        prompt: "x",
        count: 1,
        templates: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toEqual(
      new AgentImageError("no_images", "Das darf ich nicht zeichnen."),
    );
  });
});

let imageTempDirectory = "";

function createImageTool(
  service: AgentImageGeneration,
  pending = new ConversationGeneratedImages(),
): {
  run: ReturnType<typeof agentImageTool>;
  pending: ConversationGeneratedImages;
  stage: ReturnType<typeof vi.fn>;
  files: AgentImageToolDependencies["files"];
} {
  let next = 0;
  const stage = vi.fn(
    async (
      _: unknown,
      file: { readonly source: AsyncIterable<Uint8Array> },
    ) => {
      for await (const chunk of file.source)
        expect(chunk.byteLength).toBeGreaterThan(0);
      next += 1;
      return { id: `generated-${String(next)}` };
    },
  );
  const files: AgentImageToolDependencies["files"] = {
    inspect: vi.fn().mockResolvedValue("notAllowed"),
    open: vi.fn(),
  };
  const dependencies = {
    generation: service,
    attachments: { stage, release: vi.fn().mockResolvedValue(undefined) },
    pending,
    files,
    now: () => new Date("2026-11-14T12:00:00.000Z"),
  } as unknown as AgentImageToolDependencies;
  return {
    run: agentImageTool(dependencies, {
      agentId: "agent-1",
      conversationId: "conv-1",
      employee,
      assignment: imageAssignment,
    }),
    pending,
    stage,
    files,
  };
}

describe("the tool bilder_erzeugen execution (PAGE-382)", () => {
  afterEach(async () => {
    if (imageTempDirectory !== "")
      await rm(imageTempDirectory, { recursive: true, force: true });
    imageTempDirectory = "";
  });

  it("stores the images in the working folder and notes them for the answer, without a key in the result", async () => {
    imageTempDirectory = await mkdtemp(path.join(tmpdir(), "page382-"));
    const { service } = generation();
    const { run, pending, stage } = createImageTool(service);
    const outcome = await run(
      imageTempDirectory,
      { beschreibung: "Fuchs", anzahl: 2 },
      new AbortController().signal,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.result).not.toContain(KEY);
    const result: unknown = JSON.parse(outcome.result ?? "{}");
    expect(result).toMatchObject({
      erzeugt: 2,
      dateien: ["bild-20261114T120000-1.png", "bild-20261114T120000-2.png"],
    });
    expect(stage).toHaveBeenCalledWith(
      { conversationId: "conv-1", senderId: "agent-1" },
      expect.objectContaining({
        name: "bild-20261114T120000-1.png",
        mimeType: "image/png",
      }),
    );
    expect(
      await readFile(
        path.join(imageTempDirectory, "bilder", "bild-20261114T120000-1.png"),
      ),
    ).toEqual(PNG);
    expect(
      pending.take({ agentId: "agent-1", conversationId: "conv-1" }),
    ).toEqual(["generated-1", "generated-2"]);
  });

  it("says clearly that the model cannot and names the models that could, without an image", async () => {
    const { service } = generation();
    const pending = new ConversationGeneratedImages();
    const { stage } = createImageTool(service, pending);
    const run = agentImageTool(
      {
        generation: service,
        attachments: { stage, release: vi.fn() },
        pending,
        files: { inspect: vi.fn(), open: vi.fn() },
      } as unknown as AgentImageToolDependencies,
      {
        agentId: "agent-1",
        conversationId: "conv-1",
        employee,
        assignment: textAssignment,
      },
    );
    const outcome = await run(
      "/tmp/unused",
      { beschreibung: "Fuchs" },
      new AbortController().signal,
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: "IMAGE_OUTPUT_UNSUPPORTED",
    });
    expect(outcome.result).toContain(
      "Mit dem Modell claude-opus-5-5 kann ich keine Bilder erzeugen.",
    );
    expect(outcome.result).toContain("gemini-2.5-flash-image (OpenRouter)");
    expect(outcome.result).toContain("/model");
    expect(stage).not.toHaveBeenCalled();
    expect(
      pending.count({ agentId: "agent-1", conversationId: "conv-1" }),
    ).toBe(0);
  });
});

describe("the tool bilder_erzeugen errors (PAGE-382)", () => {
  it("passes a failure of the provider on as a readable message", async () => {
    const { service } = generation({
      client: {
        generate: vi
          .fn()
          .mockRejectedValue(
            new AgentImageError("provider_failed", "Guthaben aufgebraucht"),
          ),
      },
    });
    const stage = vi.fn();
    const run = agentImageTool(
      {
        generation: service,
        attachments: { stage, release: vi.fn().mockResolvedValue(undefined) },
        pending: new ConversationGeneratedImages(),
        files: {
          inspect: vi.fn().mockResolvedValue("notAllowed"),
          open: vi.fn(),
        },
      },
      {
        agentId: "agent-1",
        conversationId: "conv-1",
        employee,
        assignment: imageAssignment,
      },
    );
    const outcome = await run(
      "/tmp/unused",
      { beschreibung: "Fuchs" },
      new AbortController().signal,
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: "IMAGE_PROVIDER_FAILED",
    });
    expect(outcome.result).toContain("Die Bilderzeugung ist fehlgeschlagen");
    expect(outcome.result).toContain("Guthaben aufgebraucht");
    expect(stage).not.toHaveBeenCalled();
  });

  it("refuses a template outside the allowed places", async () => {
    const { service, client } = generation();
    const run = agentImageTool(
      {
        generation: service,
        attachments: {
          stage: vi.fn(),
          release: vi.fn().mockResolvedValue(undefined),
        },
        pending: new ConversationGeneratedImages(),
        files: {
          inspect: vi.fn().mockResolvedValue("notAllowed"),
          open: vi.fn(),
        },
      },
      {
        agentId: "agent-1",
        conversationId: "conv-1",
        employee,
        assignment: imageAssignment,
      },
    );
    const outcome = await run(
      "/tmp/unused",
      { beschreibung: "Fuchs", vorlagen: ["/home/igor/.ssh/id_rsa"] },
      new AbortController().signal,
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: "IMAGE_INVALID_TEMPLATE",
    });
    expect(client.generate).not.toHaveBeenCalled();
  });
});

describe("the tool bilder_erzeugen registration (PAGE-382)", () => {
  it("is offered only in a conversation and only with the generation wired", () => {
    const { service } = generation();
    const images: AgentImageToolDependencies = {
      generation: service,
      attachments: { stage: vi.fn(), release: vi.fn() },
      pending: new ConversationGeneratedImages(),
      files: { inspect: vi.fn(), open: vi.fn() },
    };
    const turn = { agentId: "a", employee, assignment: imageAssignment };
    expect(imageToolOf(undefined, { ...turn, conversationId: "c" })).toEqual(
      {},
    );
    expect(imageToolOf(images, { ...turn, conversationId: null })).toEqual({});
    expect(
      imageToolOf(images, { ...turn, conversationId: "c" }).generateImages,
    ).toBeTypeOf("function");
  });

  it("registers bilder_erzeugen only for a job that generates images", () => {
    const register = vi.fn();
    const registry = { register } as unknown as Parameters<
      typeof registerPicaEmployeeTools
    >[0];
    registerPicaEmployeeTools(
      registry,
      { authorize: () => Promise.resolve() },
      () => true,
    );
    expect(register).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "bilder_erzeugen" }),
    );
    registerPicaEmployeeTools(
      registry,
      { authorize: () => Promise.resolve(), generateImages: vi.fn() },
      () => true,
    );
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bilder_erzeugen" }),
    );
  });
});
