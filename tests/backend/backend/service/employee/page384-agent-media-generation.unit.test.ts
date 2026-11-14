import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GoogleMediaClient,
  OpenRouterMediaClient,
} from "@/backend/agents/providers/ProviderMediaClients";
import { pcmToWav } from "@/backend/agents/providers/ProviderMediaTransport";
import { AgentMediaError } from "@/backend/error/AgentMediaError";
import { registerPicaEmployeeTools } from "@/backend/service/chat/PicaEmployeeTools";
import { ConversationGeneratedImages } from "@/backend/service/conversation/content/ConversationGeneratedImages";
import { mediaToolOf } from "@/backend/service/employee/AgentEmployeeChatTools";
import { AgentMediaGeneration } from "@/backend/service/employee/AgentMediaGeneration";
import {
  AGENT_AUDIO_TOOL_SCHEMA,
  AGENT_VIDEO_TOOL_SCHEMA,
  agentMediaTool,
  mediaFileName,
} from "@/backend/service/employee/AgentMediaTool";
import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { isMediaOutputModel } from "@/definition/AgentMediaGeneration";
import { isChatModel, isTextCapableModel } from "@/definition/AgentModelFilter";

import type { ProviderMediaClient } from "@/backend/agents/providers/ProviderMediaClients";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentMediaGenerationDependencies } from "@/backend/service/employee/AgentMediaGeneration";
import type { AgentMediaToolDependencies } from "@/backend/service/employee/AgentMediaTool";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { PageAgentModel } from "@/definition/PageAgent";

const KEY = "sk-or-secret-key-123";
const WAV = pcmToWav(Buffer.from([1, 0, 2, 0]), 24_000);
const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);

function connection(overrides: Partial<AgentConnectionRecord> = {}): AgentConnectionRecord {
  return {
    id: "opencode-1",
    name: "OpenCode",
    provider: "opencode",
    isActive: true,
    hasApiKey: false,
    cliAccountLabel: null,
    ...overrides,
  } as AgentConnectionRecord;
}

const OPENROUTER_LINK = connection({
  id: "openrouter-1",
  name: "OpenRouter",
  provider: "openrouter",
  hasApiKey: true,
});
const GOOGLE_LINK = connection({
  id: "google-1",
  name: "Google",
  provider: "google_ai_studio",
  hasApiKey: true,
});

function catalogModel(id: string, outputModalities?: readonly string[]): AgentCatalogModel {
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

const AUDIO_MODEL = "openrouter/openai/gpt-audio";
const VIDEO_MODEL = "google/veo-chat";

function choice(id: string, outputs: readonly string[]): PageAgentModel {
  return {
    ...catalogModelChoice(
      { id: "opencode-1", name: "OpenCode", provider: "opencode" },
      catalogModel(id, outputs),
    ),
    connectionName: "OpenCode",
  };
}

function client(
  kinds: ProviderMediaClient["kinds"],
  media = [{ mimeType: "audio/wav", bytes: WAV }],
): ProviderMediaClient {
  return {
    kinds,
    generate: vi.fn().mockResolvedValue({ media, text: "", costUsd: 0.02 }),
  };
}

function generation(
  options: {
    readonly openrouter?: ProviderMediaClient;
    readonly google?: ProviderMediaClient;
  } = {},
): {
  service: AgentMediaGeneration;
  record: ReturnType<typeof vi.fn>;
  decrypt: ReturnType<typeof vi.fn>;
  openrouter: ProviderMediaClient;
  google: ProviderMediaClient;
} {
  const openrouter = options.openrouter ?? client(["audio"]);
  const google = options.google ?? client(["video", "audio"], [{ mimeType: "video/mp4", bytes: MP4 }]);
  const record = vi.fn().mockResolvedValue(undefined);
  const decrypt = vi.fn().mockReturnValue(KEY);
  const dependencies: AgentMediaGenerationDependencies = {
    connections: {
      findSecretEncrypted: vi.fn().mockResolvedValue("encrypted"),
      catalogs: () =>
        ({
          find: vi.fn().mockResolvedValue({
            models: [
              catalogModel(AUDIO_MODEL, ["text", "audio"]),
              catalogModel(VIDEO_MODEL, ["text", "video"]),
              catalogModel("openrouter/x/video-chat", ["text", "video"]),
              catalogModel("anthropic/claude-opus", ["text"]),
            ],
          }),
        }) as unknown as ReturnType<AgentMediaGenerationDependencies["connections"]["catalogs"]>,
      list: vi.fn().mockResolvedValue([OPENROUTER_LINK, GOOGLE_LINK]),
      checks: () =>
        ({
          find: vi.fn().mockResolvedValue({ status: "passed" }),
        }) as unknown as ReturnType<AgentMediaGenerationDependencies["connections"]["checks"]>,
    },
    cipher: { decrypt },
    models: {
      models: vi
        .fn()
        .mockResolvedValue([choice(AUDIO_MODEL, ["text", "audio"]), choice(VIDEO_MODEL, ["text", "video"])]),
    },
    store: {
      activity: () =>
        ({ record }) as unknown as ReturnType<AgentMediaGenerationDependencies["store"]["activity"]>,
    },
    clients: { openrouter, google_ai_studio: google },
  };
  return { service: new AgentMediaGeneration(dependencies), record, decrypt, openrouter, google };
}

const employee = { userId: "agent-1", access: "read_only" as const };
const audioAssignment = { connection: connection(), model: AUDIO_MODEL };
const videoAssignment = { connection: connection(), model: VIDEO_MODEL };
const textAssignment = {
  connection: connection({ id: "claude-1", provider: "claude_code" }),
  model: "claude-opus-5-5",
};

describe("which models generate videos and sounds (PAGE-384)", () => {
  it("decides from the stated output modalities and keeps text+media models as chat models", () => {
    expect(isMediaOutputModel({ outputModalities: ["text", "video"] }, "video")).toBe(true);
    expect(isMediaOutputModel({ outputModalities: ["text", "audio"] }, "video")).toBe(false);
    expect(isMediaOutputModel({ outputModalities: ["text", "speech"] }, "audio")).toBe(false);
    expect(isMediaOutputModel({}, "audio")).toBe(false);
    const audio = choice(AUDIO_MODEL, ["text", "audio"]);
    expect(audio.isAudioOutputCapable).toBe(true);
    expect(audio.isVideoOutputCapable).toBeUndefined();
    expect(audio.isChatCapable).toBeUndefined();
    expect(choice(VIDEO_MODEL, ["text", "video"]).isVideoOutputCapable).toBe(true);
    expect(isTextCapableModel({ id: "m", outputModalities: ["text", "video"] })).toBe(true);
    expect(isTextCapableModel({ id: "m", outputModalities: ["video"] })).toBe(false);
    expect(isTextCapableModel({ id: "m", outputModalities: ["text", "speech"] })).toBe(false);
    expect(isChatModel({ status: "active", output: { text: true, audio: true }, toolCall: true })).toBe(true);
    expect(isChatModel({ status: "active", output: { audio: true }, toolCall: true })).toBe(false);
    expect(isChatModel({ status: "active", output: { text: true, speech: true }, toolCall: true })).toBe(false);
  });
});

describe("generating with the model of the round (PAGE-384)", () => {
  it("can generate a sound with an OpenRouter model that states audio output", async () => {
    const { service } = generation();
    expect(await service.capability({ employee, assignment: audioAssignment, kind: "audio" })).toEqual({
      canGenerate: true,
      modelName: "gpt-audio",
    });
  });

  it("refuses a model without the output and names the released models that can", async () => {
    const { service } = generation();
    expect(await service.capability({ employee, assignment: textAssignment, kind: "video" })).toEqual({
      canGenerate: false,
      modelName: "claude-opus-5-5",
      reason: "no_media_output",
      alternatives: ["veo-chat (OpenCode)"],
    });
  });

  it("refuses video over OpenRouter, whose documented interface outputs audio only", async () => {
    const { service } = generation();
    expect(
      await service.capability({
        employee,
        assignment: { connection: connection(), model: "openrouter/x/video-chat" },
        kind: "video",
      }),
    ).toMatchObject({ canGenerate: false, reason: "no_media_interface" });
  });

  it("calls the provider with the stored key, never the agent's, and records the cost as the agent's", async () => {
    const { service, google, record, decrypt } = generation();
    const result = await service.generate({
      employee,
      assignment: videoAssignment,
      kind: "video",
      prompt: "Ein Fuchs springt in den Schnee",
      aspectRatio: "9:16",
      durationSeconds: 6,
      signal: new AbortController().signal,
    });
    expect(result.media.mimeType).toBe("video/mp4");
    expect(decrypt).toHaveBeenCalledWith("google-1", "encrypted");
    expect(google.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: KEY,
        model: "veo-chat",
        kind: "video",
        aspectRatio: "9:16",
        durationSeconds: 6,
      }),
    );
    expect(record).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ kind: "video", cost: { state: "known", amount: 0.02, isEstimated: false } }),
    );
  });

  it("fails clearly when the model answers without a file", async () => {
    const empty: ProviderMediaClient = {
      kinds: ["audio"],
      generate: vi.fn().mockResolvedValue({ media: [], text: "Nicht erlaubt.", costUsd: null }),
    };
    const { service } = generation({ openrouter: empty });
    await expect(
      service.generate({
        employee,
        assignment: audioAssignment,
        kind: "audio",
        prompt: "Hallo",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "no_media", detail: "Nicht erlaubt." });
  });
});

describe("video_erzeugen and audio_erzeugen (PAGE-384)", () => {
  const directories: string[] = [];
  afterEach(async () => {
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  });

  function toolDependencies(service: AgentMediaGeneration): {
    dependencies: AgentMediaToolDependencies;
    stage: ReturnType<typeof vi.fn>;
    pending: ConversationGeneratedImages;
  } {
    const stage = vi.fn().mockResolvedValue({ id: "attachment-1" });
    const pending = new ConversationGeneratedImages();
    return {
      dependencies: {
        generation: service,
        attachments: { stage, release: vi.fn().mockResolvedValue(undefined) },
        pending,
        now: () => new Date("2026-11-14T20:00:00.000Z"),
      },
      stage,
      pending,
    };
  }

  it("says clearly that the model cannot and names the models, without faking a file", async () => {
    const { service } = generation();
    const { dependencies, stage } = toolDependencies(service);
    const run = agentMediaTool(dependencies, {
      agentId: "agent-1",
      conversationId: "conversation-1",
      employee,
      assignment: textAssignment,
    });
    const outcome = await run("audio", "/tmp/unused", { beschreibung: "Ein Gong" }, new AbortController().signal);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("AUDIO_OUTPUT_UNSUPPORTED");
    expect(outcome.result).toContain("gpt-audio (OpenCode)");
    expect(outcome.result).toContain("/model");
    expect(outcome.result).toContain("Erfinde kein Sound");
    expect(stage).not.toHaveBeenCalled();
  });

  it("stores the sound in the working folder and attaches it to the answer with the 72-hour staging", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "page384-"));
    directories.push(directory);
    const { service } = generation();
    const { dependencies, stage, pending } = toolDependencies(service);
    const run = agentMediaTool(dependencies, {
      agentId: "agent-1",
      conversationId: "conversation-1",
      employee,
      assignment: audioAssignment,
    });
    const outcome = await run("audio", directory, { beschreibung: "Sag Hallo", stimme: "alloy" }, new AbortController().signal);
    expect(outcome.ok).toBe(true);
    const name = "sound-20261114T200000.wav";
    expect(await readFile(path.join(directory, "sounds", name))).toEqual(WAV);
    expect(stage).toHaveBeenCalledWith(
      { conversationId: "conversation-1", senderId: "agent-1" },
      expect.objectContaining({ name, mimeType: "audio/wav" }),
    );
    expect(pending.take({ agentId: "agent-1", conversationId: "conversation-1" })).toEqual(["attachment-1"]);
    expect(outcome.result).not.toContain(KEY);
  });

  it("passes a provider failure on as a readable message", async () => {
    const failing: ProviderMediaClient = {
      kinds: ["audio"],
      generate: vi.fn().mockRejectedValue(new AgentMediaError("provider_failed", "quota")),
    };
    const { service } = generation({ openrouter: failing });
    const { dependencies } = toolDependencies(service);
    const outcome = await agentMediaTool(dependencies, {
      agentId: "agent-1",
      conversationId: "conversation-1",
      employee,
      assignment: audioAssignment,
    })("audio", "/tmp/unused", { beschreibung: "x" }, new AbortController().signal);
    expect(outcome).toMatchObject({ ok: false, error: "AUDIO_PROVIDER_FAILED" });
    expect(outcome.result).toContain("quota");
  });

  it("checks the input and names generated files by kind", () => {
    expect(AGENT_VIDEO_TOOL_SCHEMA.safeParse({ beschreibung: "x", dauer: 9 }).success).toBe(false);
    expect(AGENT_VIDEO_TOOL_SCHEMA.safeParse({ beschreibung: "x", seitenverhaeltnis: "16:9", dauer: 8 }).success).toBe(true);
    expect(AGENT_AUDIO_TOOL_SCHEMA.safeParse({ beschreibung: "x", stimme: "bad voice!" }).success).toBe(false);
    expect(mediaFileName("video", new Date("2026-11-14T20:00:00.000Z"), "video/webm")).toBe("video-20261114T200000.webm");
  });

  it("offers the tools only in a conversation and registers both", () => {
    expect(mediaToolOf(undefined, { agentId: "a", conversationId: "c", employee, assignment: audioAssignment })).toEqual({});
    const { service } = generation();
    const { dependencies } = toolDependencies(service);
    expect(mediaToolOf(dependencies, { agentId: "a", conversationId: null, employee, assignment: audioAssignment })).toEqual({});
    expect(
      mediaToolOf(dependencies, { agentId: "a", conversationId: "c", employee, assignment: audioAssignment }).generateMedia,
    ).toBeTypeOf("function");
    const register = vi.fn();
    const registry = { register } as unknown as Parameters<typeof registerPicaEmployeeTools>[0];
    registerPicaEmployeeTools(registry, { authorize: () => Promise.resolve() }, () => true);
    expect(register).not.toHaveBeenCalledWith(expect.objectContaining({ id: "video_erzeugen" }));
    registerPicaEmployeeTools(registry, { authorize: () => Promise.resolve(), generateMedia: vi.fn() }, () => true);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: "video_erzeugen" }));
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: "audio_erzeugen" }));
  });
});

describe("the video and audio interfaces of the providers (PAGE-384)", () => {
  it("streams OpenRouter audio as PCM and stores it as WAV with the cost", async () => {
    const pcm = Buffer.from([1, 0, 2, 0, 3, 0]);
    const stream = [
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: pcm.subarray(0, 4).toString("base64"), transcript: "Hal" } } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: pcm.subarray(4).toString("base64"), transcript: "lo" } } }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { cost: 0.003 } })}`,
      "data: [DONE]",
    ].join("\n\n");
    const transport = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    const answer = await new OpenRouterMediaClient(transport).generate({
      apiKey: KEY,
      model: "openai/gpt-audio",
      kind: "audio",
      prompt: "Hallo",
      signal: new AbortController().signal,
    });
    expect(answer.media[0]?.mimeType).toBe("audio/wav");
    expect(answer.media[0]?.bytes).toEqual(pcmToWav(pcm, 24_000));
    expect(answer.text).toBe("Hallo");
    expect(answer.costUsd).toBe(0.003);
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init.body))).toMatchObject({
      modalities: ["text", "audio"],
      audio: { format: "pcm16" },
      stream: true,
    });
    await expect(
      new OpenRouterMediaClient(transport).generate({
        apiKey: KEY,
        model: "x",
        kind: "video",
        prompt: "x",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "no_media_interface" });
  });

  it("puts Gemini speech PCM into a WAV file at its rate", async () => {
    const pcm = Buffer.from([5, 0, 6, 0]);
    const transport = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=16000", data: pcm.toString("base64") } }] } },
        ],
      }),
    );
    const answer = await new GoogleMediaClient(transport).generate({
      apiKey: KEY,
      model: "gemini-tts",
      kind: "audio",
      prompt: "Hallo",
      signal: new AbortController().signal,
    });
    expect(answer.media[0]?.bytes).toEqual(pcmToWav(pcm, 16_000));
    const body = JSON.parse(String((transport.mock.calls[0] as [string, RequestInit])[1].body)) as {
      generationConfig: { responseModalities: string[] };
    };
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
  });

  it("starts a Veo operation, waits for it and loads the video without sending the key to the storage", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers = [
      Response.json({ name: "models/veo/operations/op-1" }),
      Response.json({ name: "models/veo/operations/op-1", done: false }),
      Response.json({
        name: "models/veo/operations/op-1",
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [
              { video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media" } },
            ],
          },
        },
      }),
      new Response(null, { status: 302, headers: { location: "https://storage.example/video.mp4" } }),
      new Response(MP4, { status: 200, headers: { "content-type": "video/mp4" } }),
    ];
    const transport = vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(answers.shift() ?? new Response(null, { status: 500 }));
    });
    const answer = await new GoogleMediaClient(transport as unknown as typeof fetch, 1).generate({
      apiKey: KEY,
      model: "veo",
      kind: "video",
      prompt: "Fuchs",
      aspectRatio: "16:9",
      durationSeconds: 8,
      signal: new AbortController().signal,
    });
    expect(answer.media[0]).toEqual({ mimeType: "video/mp4", bytes: MP4 });
    expect(calls[0]?.url).toContain("models/veo:predictLongRunning");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      instances: [{ prompt: "Fuchs" }],
      parameters: { aspectRatio: "16:9", durationSeconds: 8 },
    });
    expect(calls[1]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/veo/operations/op-1");
    expect(calls[4]?.url).toBe("https://storage.example/video.mp4");
    expect(JSON.stringify(calls[4]?.init.headers ?? {})).not.toContain(KEY);
  });

  it("refuses a download address outside the Gemini API", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ name: "op", done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://evil.example/x" } }] } } }));
    await expect(
      new GoogleMediaClient(transport, 1).generate({
        apiKey: KEY,
        model: "veo",
        kind: "video",
        prompt: "x",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "provider_failed" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
