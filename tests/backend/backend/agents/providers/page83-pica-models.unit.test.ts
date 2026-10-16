import { afterEach, expect, it, vi } from "vitest";

import { PicaApiModels } from "@/backend/agents/providers/PicaApiModels";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { ASSIGNMENT } from "../../service/chat/page48-chat-fixture";

import type { ApiProviderId } from "@/definition/AgentConnection";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function modelWorld(agent: ResolvedAgentAssignment = ASSIGNMENT): {
  readonly connections: {
    readonly find: ReturnType<typeof vi.fn>;
    readonly findSecretEncrypted: ReturnType<typeof vi.fn>;
  };
  readonly access: { readonly requireUser: ReturnType<typeof vi.fn> };
  readonly cipher: { readonly decrypt: ReturnType<typeof vi.fn> };
  readonly operations: AgentOperationRegistry;
  readonly models: PicaApiModels;
} {
  const connections = {
    find: vi.fn(async () => agent.connection),
    findSecretEncrypted: vi.fn(async (): Promise<string | null> => "encrypted"),
  };
  const access = { requireUser: vi.fn(async () => undefined) };
  const cipher = { decrypt: vi.fn(() => "synthetic-key") };
  const operations = new AgentOperationRegistry();
  return {
    connections,
    access,
    cipher,
    operations,
    models: new PicaApiModels({ connections, access, cipher, operations }),
  };
}

it.each([
  "openai",
  "openrouter",
  "anthropic",
  "google_ai_studio",
  "zai",
] as const)(
  "resolves %s from saved credentials without network or environment keys",
  async (provider) => {
    const request = vi.fn(async () => {
      throw new Error("No provider request expected");
    });
    vi.stubGlobal("fetch", request);
    const agent = {
      ...ASSIGNMENT,
      connection: { ...ASSIGNMENT.connection, provider },
    };
    const world = modelWorld(agent);
    const result = await world.models.use(
      { userId: "owner", agent },
      new AbortController().signal,
      async (resolved) => {
        expect(resolved.model.modelId).toBe(ASSIGNMENT.model);
        expect(resolved.model.specificationVersion).toBe("v3");
        expect(() =>
          world.operations.acquire(agent.connection.id, "write"),
        ).toThrow();
        return resolved.redact("synthetic-key");
      },
    );
    expect(result).toBe("[redacted]");
    expect(world.access.requireUser).toHaveBeenCalledWith(
      "owner",
      ASSIGNMENT.connection.id,
    );
    expect(world.cipher.decrypt).toHaveBeenCalledWith(
      ASSIGNMENT.connection.id,
      "encrypted",
    );
    expect(request).not.toHaveBeenCalled();
    world.operations.acquire(agent.connection.id, "write")();
  },
);

it("pins endpoint and model and sends native schemas, results and configured reasoning through the bundled SDK", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({
      id: "response",
      object: "response",
      created_at: 0,
      model: "o3",
      status: "completed",
      output: [
        {
          type: "message",
          id: "msg",
          role: "assistant",
          content: [{ type: "output_text", text: "Antwort", annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }),
  );
  vi.stubGlobal("fetch", request);
  vi.stubEnv("OPENAI_BASE_URL", "https://unexpected.invalid");
  const agent = { ...ASSIGNMENT, model: "o3", reasoningEffort: "high" };
  const world = modelWorld(agent);
  await world.models.use(
    { userId: "owner", agent },
    new AbortController().signal,
    async ({ model, providerOptions }) => {
      if (model.specificationVersion !== "v3")
        throw new Error("Unexpected SDK version");
      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        tools: [
          {
            type: "function",
            name: "tickets_read",
            description: "Read",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: { ticketId: { type: "string" } },
              required: ["ticketId"],
            },
          },
        ],
        providerOptions,
      });
      expect(result.content).toContainEqual(
        expect.objectContaining({ type: "text", text: "Antwort" }),
      );
    },
  );
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0]?.[0]).toBe(
    "https://api.openai.com/v1/responses",
  );
  const options = request.mock.calls[0]?.[1];
  expect(options?.headers).toMatchObject({
    authorization: "Bearer synthetic-key",
  });
  const body: unknown = JSON.parse(String(options?.body));
  expect(body).toMatchObject({
    model: "o3",
    store: false,
    reasoning: { effort: "high" },
    tools: [{ name: "tickets_read", type: "function" }],
  });
});

it.each([
  "missing",
  "inactive",
  "different",
  "denied",
  "decrypt",
  "empty",
] as const)(
  "fails closed before provider execution for %s access and always releases its lock",
  async (failure) => {
    const world = modelWorld();
    if (failure === "missing")
      world.connections.findSecretEncrypted.mockResolvedValue(null);
    if (failure === "inactive")
      world.connections.find.mockResolvedValue({
        ...ASSIGNMENT.connection,
        isActive: false,
      });
    if (failure === "different")
      world.connections.find.mockResolvedValue({
        ...ASSIGNMENT.connection,
        provider: "anthropic",
      });
    if (failure === "denied")
      world.access.requireUser.mockRejectedValue(
        new TextAssistantError("accessDenied"),
      );
    if (failure === "decrypt")
      world.cipher.decrypt.mockImplementation(() => {
        throw new Error("decryption failed");
      });
    if (failure === "empty") world.cipher.decrypt.mockReturnValue("");
    const run = vi.fn(async () => "unexpected");
    await expect(
      world.models.use(
        { userId: "owner", agent: ASSIGNMENT },
        new AbortController().signal,
        run,
      ),
    ).rejects.toBeInstanceOf(TextAssistantError);
    expect(run).not.toHaveBeenCalled();
    world.operations.acquire(ASSIGNMENT.connection.id, "write")();
  },
);

it("preserves configured reasoning options for all supported API providers", async () => {
  const providers: readonly ApiProviderId[] = [
    "openai",
    "openrouter",
    "anthropic",
    "google_ai_studio",
    "zai",
  ];
  for (const provider of providers) {
    const agent = {
      ...ASSIGNMENT,
      reasoningEffort: "high",
      connection: { ...ASSIGNMENT.connection, provider },
    };
    const world = modelWorld(agent);
    await world.models.use(
      { userId: "owner", agent },
      new AbortController().signal,
      async ({ providerOptions }) => {
        expect(JSON.stringify(providerOptions)).toContain("high");
        if (provider === "openrouter")
          expect(providerOptions).toMatchObject({
            openrouter: { provider: { allow_fallbacks: false } },
          });
      },
    );
  }
});

it.each([
  [
    "openrouter",
    "https://openrouter.ai/api/v1/chat/completions",
    {
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Antwort" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
    { reasoning: { effort: "high" }, provider: { allow_fallbacks: false } },
  ],
  [
    "zai",
    "https://api.z.ai/api/paas/v4/chat/completions",
    {
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Antwort" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
    { reasoning_effort: "high" },
  ],
  [
    "anthropic",
    "https://api.anthropic.com/v1/messages",
    {
      type: "message",
      id: "message",
      model: "synthetic",
      role: "assistant",
      content: [{ type: "text", text: "Antwort" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    { output_config: { effort: "high" } },
  ],
  [
    "google_ai_studio",
    "https://generativelanguage.googleapis.com/v1beta/models/synthetic:generateContent",
    {
      candidates: [
        {
          index: 0,
          content: { role: "model", parts: [{ text: "Antwort" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    },
    { generationConfig: { thinkingConfig: { thinkingLevel: "high" } } },
  ],
] as const)(
  "uses the fixed %s native endpoint and preserves reasoning in the actual SDK payload",
  async (provider, endpoint, payload, expected) => {
    const request = vi.fn<typeof fetch>(async () => Response.json(payload));
    vi.stubGlobal("fetch", request);
    const agent = {
      ...ASSIGNMENT,
      reasoningEffort: "high",
      connection: { ...ASSIGNMENT.connection, provider },
    };
    const world = modelWorld(agent);
    await world.models.use(
      { userId: "owner", agent },
      new AbortController().signal,
      async ({ model, providerOptions }) => {
        if (model.specificationVersion !== "v3")
          throw new Error("Unexpected SDK version");
        const result = await model.doGenerate({
          prompt: [
            { role: "user", content: [{ type: "text", text: "Hello" }] },
          ],
          tools: [
            {
              type: "function",
              name: "tickets_read",
              description: "Read",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: { ticketId: { type: "string" } },
                required: ["ticketId"],
              },
            },
          ],
          providerOptions,
        });
        expect(result.content).toContainEqual(
          expect.objectContaining({ type: "text", text: "Antwort" }),
        );
      },
    );
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe(endpoint);
    const body: unknown = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject(expected);
    expect(JSON.stringify(body)).toContain("tickets_read");
    if (provider === "google_ai_studio")
      expect(body).toMatchObject({
        tools: [
          {
            functionDeclarations: [
              {
                name: "tickets_read",
                parameters: {
                  required: ["ticketId"],
                  properties: { ticketId: { type: "string" } },
                },
              },
            ],
          },
        ],
      });
    else expect(JSON.stringify(body)).toContain("additionalProperties");
  },
);
