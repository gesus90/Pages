import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentChatCommandService } from "@/backend/service/employee/AgentChatCommandService";

import type { AgentChatCommandDependencies } from "@/backend/service/employee/AgentChatCommandService";
import type {
  AgentChatModelChoice,
  AgentChatModelOverview,
} from "@/definition/AgentChatControl";
import type { User } from "@/definition/User";

const igor: User = {
  id: "igor",
  username: "igor",
  displayName: "Igor",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const ed: User = { ...igor, id: "ed", username: "ed", displayName: "Ed", isAgent: true };
const mei: User = { ...igor, id: "mei", username: "mei", displayName: "Mei", isAgent: true };

function choice(model: string, name: string, aliases: string[] = []): AgentChatModelChoice {
  return {
    connectionId: "claude",
    model,
    name,
    connectionName: "Claude Code",
    provider: "claude_code",
    reasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
    contextWindow: 200_000,
    aliases,
  };
}

const OVERVIEW: AgentChatModelOverview = {
  agentId: "ed",
  agentName: "Ed",
  standard: {
    connectionId: "claude",
    model: "claude-sonnet-5-5",
    reasoningEffort: null,
    name: "Claude Sonnet 5.5",
  },
  override: null,
  choices: [
    choice("claude-opus-5-5", "Claude Opus 5.5", ["opus"]),
    choice("claude-sonnet-5-5", "Claude Sonnet 5.5", ["sonnet"]),
    choice("claude-haiku-5-5", "Claude Haiku 5.5"),
  ],
  canControl: true,
};

const control = {
  overview: vi.fn(),
  setModel: vi.fn(),
  renew: vi.fn(),
  compact: vi.fn(),
};
const groupMembers = vi.fn();

function service(): AgentChatCommandService {
  const users = new Map([igor, ed, mei].map((entry) => [entry.id, entry]));
  return new AgentChatCommandService({
    users: { findById: async (id: string) => users.get(id) ?? null },
    access: { groupMembers },
    control,
  } as unknown as AgentChatCommandDependencies);
}

const DIRECT = { kind: "direct" as const, agentId: "ed" };
const GROUP = { kind: "group" as const, conversationId: "team" };

beforeEach(() => {
  vi.resetAllMocks();
  control.overview.mockResolvedValue(OVERVIEW);
  control.setModel.mockResolvedValue(OVERVIEW);
  control.renew.mockResolvedValue({ agent: ed });
  control.compact.mockResolvedValue({ agent: ed });
  groupMembers.mockResolvedValue(["igor", "ed", "mei"]);
});

describe("the chat commands (PAGE-380)", () => {
  it("changes model and level in a group by `/model @Ed opus hoch`", async () => {
    const outcome = await service().run(igor, GROUP, "/model @Ed opus hoch");
    expect(control.setModel).toHaveBeenCalledWith(
      igor,
      { kind: "group", agentId: "ed", conversationId: "team" },
      { connectionId: "claude", model: "claude-opus-5-5", reasoningEffort: "high" },
    );
    expect(outcome).toEqual({ status: "done", command: "model", agentName: "Ed" });
  });

  it("shows the current model and the choice for `/model` and resets with `/model reset`", async () => {
    const shown = await service().run(igor, DIRECT, "/model");
    expect(shown).toMatchObject({
      status: "chooseModel",
      query: "",
      mention: null,
      matches: OVERVIEW.choices,
    });
    expect(control.setModel).not.toHaveBeenCalled();
    await service().run(igor, DIRECT, "/model reset");
    expect(control.setModel).toHaveBeenCalledWith(igor, DIRECT, null);
  });

  it("lists the matches of an ambiguous name instead of guessing", async () => {
    const outcome = await service().run(igor, GROUP, "/model @ed claude");
    expect(outcome).toMatchObject({ status: "chooseModel", query: "claude", mention: "ed" });
    expect(outcome.status === "chooseModel" ? outcome.matches : []).toHaveLength(3);
    expect(control.setModel).not.toHaveBeenCalled();
    expect(await service().run(igor, DIRECT, "/model gemini")).toEqual({
      status: "unknownModel",
      query: "gemini",
    });
    expect(await service().run(igor, DIRECT, "/model opus ultra")).toEqual({
      status: "unknownEffort",
      effort: "ultra",
      efforts: ["low", "medium", "high"],
    });
  });

  it("asks which agent a group command without `@Agent` means, instead of steering all", async () => {
    const outcome = await service().run(igor, GROUP, "/new");
    expect(outcome).toEqual({
      status: "chooseAgent",
      command: "new",
      agents: [
        { id: "ed", name: "Ed", username: "ed" },
        { id: "mei", name: "Mei", username: "mei" },
      ],
    });
    expect(control.renew).not.toHaveBeenCalled();
    expect(await service().run(igor, GROUP, "/compact @bakuman")).toEqual({
      status: "unknownAgent",
      mention: "bakuman",
    });
  });

  it("runs `/new` and `/compact` for the named agent", async () => {
    expect(await service().run(igor, GROUP, "/new @mei")).toMatchObject({
      status: "done",
      command: "new",
    });
    expect(control.renew).toHaveBeenCalledWith(igor, {
      kind: "group",
      agentId: "mei",
      conversationId: "team",
    });
    await service().run(igor, DIRECT, "/compact");
    expect(control.compact).toHaveBeenCalledWith(igor, DIRECT);
  });

  it("answers a member without the right with a hint and changes nothing", async () => {
    control.compact.mockRejectedValue(new AgentEmployeeError("forbidden"));
    expect(await service().run(igor, GROUP, "/compact @ed")).toEqual({
      status: "forbidden",
    });
  });

  it("never runs a command of an agent", async () => {
    expect(await service().run(ed, GROUP, "/model @mei opus")).toEqual({
      status: "forbidden",
    });
    expect(await service().run(mei, DIRECT, "/new")).toEqual({ status: "forbidden" });
    expect(control.setModel).not.toHaveBeenCalled();
    expect(control.renew).not.toHaveBeenCalled();
    expect(groupMembers).not.toHaveBeenCalled();
  });

  it("refuses a text that is no command", async () => {
    await expect(service().run(igor, DIRECT, "Hallo /new")).rejects.toMatchObject({
      code: "invalidInput",
    });
  });
});
