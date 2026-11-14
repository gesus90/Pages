import { describe, expect, it, vi } from "vitest";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentChatAccess } from "@/backend/service/employee/AgentChatAccess";
import { AgentChatControlService } from "@/backend/service/employee/AgentChatControlService";
import {
  AgentChatModelChoices,
  isChatModelChoice,
} from "@/backend/service/employee/AgentChatModelChoices";

import type { StoredAgentChatModel } from "@/backend/database/repositories/employee/AgentChatModelRepository";
import type { AgentChatAccessDependencies } from "@/backend/service/employee/AgentChatAccess";
import type { AgentChatControlDependencies } from "@/backend/service/employee/AgentChatControlService";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { User } from "@/definition/User";

function user(id: string, fields: Partial<User> = {}): User {
  return {
    id,
    username: id,
    displayName: id.charAt(0).toUpperCase() + id.slice(1),
    role: "employee",
    isActive: true,
    mustChangePassword: false,
    ...fields,
  };
}

const igor = user("igor", { displayName: "Igor" });
const anna = user("anna", { displayName: "Anna" });
const mei = user("mei", { displayName: "Mei" });
const ed = user("ed", { displayName: "Ed", isAgent: true });

function model(fields: Partial<PageAgentModel> & { model: string }): PageAgentModel {
  return {
    id: `anthropic:${fields.model}`,
    connectionId: "anthropic",
    connectionName: "Anthropic",
    name: fields.model,
    modelName: fields.model,
    reasoning: "supported",
    reasoningEfforts: ["low", "medium", "high"],
    catalogDefaultReasoningEffort: "medium",
    reasoningEffort: null,
    provider: "claude_code",
    isToolCapable: true,
    isChatCapable: true,
    ...fields,
  };
}

/** The catalog the agent may use: text models and special models that must stay out. */
const CATALOG: PageAgentModel[] = [
  model({ model: "claude-opus-5-5", modelName: "Claude Opus 5.5" }),
  model({ model: "claude-sonnet-5-5", modelName: "Claude Sonnet 5.5" }),
  model({
    connectionId: "openrouter",
    connectionName: "OpenRouter",
    provider: "opencode",
    model: "z-ai/glm-5.3",
    modelName: "GLM 5.3",
  }),
  model({
    connectionId: "openrouter",
    provider: "opencode",
    model: "router/decide",
    isDecisionCapable: true,
  }),
  model({
    connectionId: "openrouter",
    provider: "opencode",
    model: "voice/tts",
    isSpeechOutputCapable: true,
  }),
  model({
    connectionId: "openrouter",
    provider: "opencode",
    model: "whisper",
    isTranscriptionOnly: true,
  }),
  model({
    connectionId: "openrouter",
    provider: "opencode",
    model: "image/gen",
    isChatCapable: false,
  }),
  // A direct API connection has no chat adapter, so neither Pica nor an agent answers with it.
  model({
    connectionId: "openai-api",
    connectionName: "OpenAI API",
    provider: "openai",
    model: "gpt-5.5",
  }),
];

interface Fixture {
  readonly control: AgentChatControlService;
  readonly overrides: Map<string, StoredAgentChatModel>;
  readonly lifecycle: { restart: ReturnType<typeof vi.fn>; renew: ReturnType<typeof vi.fn> };
  readonly setNeedsRestart: ReturnType<typeof vi.fn>;
  readonly systemLine: ReturnType<typeof vi.fn>;
  readonly modelsOf: ReturnType<typeof vi.fn>;
}

function key(entry: { agentId: string; chatKind: string; chatId: string }): string {
  return `${entry.agentId}:${entry.chatKind}:${entry.chatId}`;
}

function fixture(options: { readonly controllers?: string[] } = {}): Fixture {
  const overrides = new Map<string, StoredAgentChatModel>();
  const setNeedsRestart = vi.fn(async () => undefined);
  const chatModels = {
    find: vi.fn(async (entry: StoredAgentChatModel) => overrides.get(key(entry)) ?? null),
    save: vi.fn(async (entry: StoredAgentChatModel) => {
      overrides.set(key(entry), entry);
    }),
    remove: vi.fn(async (entry: StoredAgentChatModel) => {
      overrides.delete(key(entry));
    }),
  };
  const store = {
    employees: () => ({
      find: vi.fn(async (id: string) =>
        id === "ed"
          ? {
              userId: "ed",
              connectionId: "anthropic",
              model: "claude-sonnet-5-5",
              reasoningEffort: "medium",
              access: "workspace",
            }
          : null,
      ),
    }),
    conversations: () => ({
      find: vi.fn(async () => ({ sessionId: "session-ed" })),
    }),
    chatModels: () => chatModels,
    chatSessions: () => ({ setNeedsRestart }),
    sessionControllers: () => ({
      list: vi.fn(async () => options.controllers ?? []),
    }),
  };
  const accounts = new Map([igor, anna, mei, ed].map((entry) => [entry.id, entry]));
  const access = new AgentChatAccess({
    store,
    users: { findById: async (id: string) => accounts.get(id) ?? null },
    conversations: {
      findForMember: async (conversationId: string, userId: string) =>
        conversationId === "team" && userId !== "stranger"
          ? { id: "team", kind: "group" }
          : null,
      createdBy: async () => "igor",
      memberIds: async () => new Map([["team", ["igor", "anna", "mei", "ed"]]]),
    },
  } as unknown as AgentChatAccessDependencies);
  const modelsOf = vi.fn(async () => CATALOG);
  const lifecycle = {
    restart: vi.fn(async () => undefined),
    renew: vi.fn(async () => undefined),
  };
  const systemLine = vi.fn(async () => undefined);
  const control = new AgentChatControlService({
    store,
    access,
    choices: new AgentChatModelChoices({ models: { models: modelsOf } }),
    lifecycle,
    systemLine,
    now: () => new Date("2026-11-14T12:00:00.000Z"),
  } as unknown as AgentChatControlDependencies);
  return { control, overrides, lifecycle, setNeedsRestart, systemLine, modelsOf };
}

const DIRECT = { kind: "direct" as const, agentId: "ed" };
const GROUP = { kind: "group" as const, agentId: "ed", conversationId: "team" };

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the model choice of an agent in a chat (PAGE-380)", () => {
  it("offers exactly the text models of the agent's connections, no decision, speech, transcription or image model", async () => {
    const { control, modelsOf } = fixture();
    const overview = await control.overview(igor, DIRECT);
    // The choice is read for the agent's own account, so its released connections apply.
    expect(modelsOf).toHaveBeenCalledWith("ed");
    expect(overview.choices.map((entry) => entry.model)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "z-ai/glm-5.3",
    ]);
    expect(overview.choices[0]).toMatchObject({
      name: "Claude Opus 5.5",
      connectionName: "Anthropic",
      reasoningEfforts: ["low", "medium", "high"],
    });
    expect(overview.standard).toMatchObject({
      model: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
    });
    expect(overview.override).toBeNull();
    expect(isChatModelChoice(model({ model: "x", isSpeechCapable: true }), { access: "workspace" })).toBe(false);
  });

  it("switches the direct chat to another model: stored, the session ends on purpose and a system line follows", async () => {
    const { control, overrides, lifecycle, setNeedsRestart, systemLine } = fixture();
    const overview = await control.setModel(igor, DIRECT, {
      connectionId: "anthropic",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
    });
    expect(overrides.get("ed:direct:igor")).toMatchObject({
      model: "claude-opus-5-5",
      reasoningEffort: "high",
    });
    expect(overview.override).toMatchObject({ name: "Claude Opus 5.5" });
    // The mark makes the next round wait; the restart writes the summary after a running answer.
    expect(setNeedsRestart).toHaveBeenCalledWith("session-ed", true);
    await settle();
    expect(lifecycle.restart).toHaveBeenCalledWith(ed, "session-ed");
    expect(lifecycle.renew).not.toHaveBeenCalled();
    expect(systemLine).toHaveBeenCalledWith(igor, {
      kind: "direct",
      chatId: "igor",
      agentId: "ed",
      text: "Igor hat Ed in diesem Chat auf Claude Opus 5.5 · hoch umgestellt.",
    });
  });

  it("resets to the agent's own model with the same switch", async () => {
    const { control, overrides, lifecycle, systemLine } = fixture();
    await control.setModel(igor, DIRECT, {
      connectionId: "anthropic",
      model: "claude-opus-5-5",
      reasoningEffort: null,
    });
    const overview = await control.setModel(igor, DIRECT, null);
    expect(overrides.size).toBe(0);
    expect(overview.override).toBeNull();
    await settle();
    expect(lifecycle.restart).toHaveBeenCalledTimes(2);
    expect(systemLine).toHaveBeenLastCalledWith(
      igor,
      expect.objectContaining({
        text: "Igor hat Ed in diesem Chat auf das Standardmodell Claude Sonnet 5.5 · mittel zurückgesetzt.",
      }),
    );
  });

  it("refuses a model outside the choice and a level the model does not offer", async () => {
    const { control, overrides } = fixture();
    await expect(
      control.setModel(igor, DIRECT, {
        connectionId: "openrouter",
        model: "router/decide",
        reasoningEffort: null,
      }),
    ).rejects.toMatchObject({ code: "modelNotAllowed" });
    await expect(
      control.setModel(igor, DIRECT, {
        connectionId: "anthropic",
        model: "claude-opus-5-5",
        reasoningEffort: "ultra",
      }),
    ).rejects.toMatchObject({ code: "modelNotAllowed" });
    await expect(control.setModel(igor, DIRECT, { model: 3 })).rejects.toMatchObject({
      code: "invalidInput",
    });
    expect(overrides.size).toBe(0);
  });
});

describe("who steers the agents of a group (PAGE-380)", () => {
  it("lets only the owner by default; another member gets forbidden and nothing happens", async () => {
    const { control, overrides, lifecycle, systemLine, setNeedsRestart } = fixture();
    await expect(
      control.setModel(anna, GROUP, {
        connectionId: "anthropic",
        model: "claude-opus-5-5",
        reasoningEffort: null,
      }),
    ).rejects.toEqual(new AgentEmployeeError("forbidden"));
    await expect(control.renew(anna, GROUP)).rejects.toMatchObject({ code: "forbidden" });
    await expect(control.compact(anna, GROUP)).rejects.toMatchObject({ code: "forbidden" });
    await settle();
    expect(overrides.size).toBe(0);
    expect(setNeedsRestart).not.toHaveBeenCalled();
    expect(lifecycle.restart).not.toHaveBeenCalled();
    expect(lifecycle.renew).not.toHaveBeenCalled();
    expect(systemLine).not.toHaveBeenCalled();
    // The overview still shows what applies, without the right.
    expect((await control.overview(anna, GROUP)).canControl).toBe(false);
  });

  it("lets a member the owner allowed steer, and never an agent", async () => {
    const { control, overrides } = fixture({ controllers: ["anna"] });
    await control.setModel(anna, GROUP, {
      connectionId: "anthropic",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
    });
    expect(overrides.get("ed:group:team")).toMatchObject({ model: "claude-opus-5-5" });
    await expect(control.setModel(mei, GROUP, null)).rejects.toMatchObject({
      code: "forbidden",
    });
    // An agent is never allowed, not even listed as a controller.
    const agentFixture = fixture({ controllers: ["ed"] });
    await expect(agentFixture.control.compact(ed, GROUP)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(agentFixture.control.renew(ed, DIRECT)).rejects.toMatchObject({
      code: "notFound",
    });
  });

  it("answers notFound to somebody outside the group", async () => {
    const { control } = fixture();
    await expect(
      control.overview(user("stranger"), GROUP),
    ).rejects.toMatchObject({ code: "notFound" });
  });
});

describe("/new and /compact from the menu (PAGE-380)", () => {
  it("replaces the session by an empty one and keeps the model of the chat", async () => {
    const { control, overrides, lifecycle, systemLine } = fixture();
    await control.setModel(igor, GROUP, {
      connectionId: "anthropic",
      model: "claude-opus-5-5",
      reasoningEffort: null,
    });
    lifecycle.restart.mockClear();
    await control.renew(igor, GROUP);
    await settle();
    expect(lifecycle.renew).toHaveBeenCalledWith(ed, "session-ed");
    expect(lifecycle.restart).not.toHaveBeenCalled();
    expect(overrides.get("ed:group:team")).toMatchObject({ model: "claude-opus-5-5" });
    expect(systemLine).toHaveBeenLastCalledWith(igor, {
      kind: "group",
      chatId: "team",
      agentId: "ed",
      text: "Igor hat die Sitzung von Ed neu gestartet.",
    });
  });

  it("compacts at once, whatever the context fill, with the restart of the threshold", async () => {
    const { control, lifecycle, setNeedsRestart, systemLine } = fixture();
    await control.compact(igor, DIRECT);
    expect(setNeedsRestart).toHaveBeenCalledWith("session-ed", true);
    await settle();
    expect(lifecycle.restart).toHaveBeenCalledWith(ed, "session-ed");
    expect(systemLine).toHaveBeenCalledWith(
      igor,
      expect.objectContaining({ text: "Igor hat die Sitzung von Ed verdichtet." }),
    );
  });
});
