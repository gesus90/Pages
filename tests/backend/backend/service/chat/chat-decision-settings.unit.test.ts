import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AgentCatalogRepository } from "@/backend/database/repositories/agent/AgentCatalogRepository";
import { AgentConnectionScopeRepository } from "@/backend/database/repositories/agent/AgentConnectionScopeRepository";
import { ChatDecisionSettingsRepository } from "@/backend/database/repositories/chat/ChatDecisionSettingsRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { ChatDecisionSettingsService } from "@/backend/service/chat/ChatDecisionSettingsService";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";
import { CONVERSATION_DEFAULT_DECISION_RULES } from "@/definition/ConversationDecision";

import { bareInstance } from "../tasks/bare-instance";
import { ASSIGNMENT } from "./page48-chat-fixture";

import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentModelSelection } from "@/definition/AgentModelSelection";
import type { AccountAccess } from "@/definition/Authorization";
import type { ChatDecisionSettings } from "@/definition/ConversationDecision";

const OPENROUTER: AgentConnectionRecord = {
  ...ASSIGNMENT.connection,
  id: "openrouter",
  name: "OpenRouter",
  provider: "openrouter",
  hasApiKey: true,
  isActive: true,
};
const GOOGLE: AgentConnectionRecord = {
  ...OPENROUTER,
  id: "google",
  name: "Google",
  provider: "google_ai_studio",
};
const INACTIVE: AgentConnectionRecord = {
  ...OPENROUTER,
  id: "inactive",
  isActive: false,
};

function catalogModel(
  id: string,
  name: string,
  outputModalities: readonly string[],
): ReturnType<typeof emptyModelCatalog>["models"][number] {
  return {
    id,
    name,
    contextWindow: null,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    reasoning: "none",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    inputModalities: ["text"],
    outputModalities,
  };
}

const DECIDER = catalogModel(
  "perplexity/pplx-decider-v1.3",
  "Perplexity Decider V1.3",
  ["decisions"],
);
const FLASH = catalogModel(
  "perplexity/pplx-decider-flash-v1.3",
  "Decider Flash V1.3",
  ["decisions"],
);
const CHAT = catalogModel("vendor/chat", "Chat", ["text"]);

const ADMIN: AccountAccess = {
  userId: "admin",
  role: null,
  isAdmin: true,
  mode: "admin",
  firstName: "Ad",
  lastName: "Min",
  isActive: true,
  departments: [],
  managedDepartments: [],
  allDepartments: true,
  allProjects: true,
  hasHadDepartment: false,
};
const EMPLOYEE: AccountAccess = {
  ...ADMIN,
  userId: "employee",
  isAdmin: false,
  mode: "user",
};

function world(isSimulation = false): {
  service: ChatDecisionSettingsService;
  stored: { current: ChatDecisionSettings };
  save: ReturnType<typeof vi.fn>;
} {
  const connections = bareInstance(AgentConnectionRepository.prototype);
  const catalogs = bareInstance(AgentCatalogRepository.prototype);
  const scopes = bareInstance(AgentConnectionScopeRepository.prototype);
  vi.spyOn(connections, "list").mockResolvedValue([OPENROUTER, GOOGLE, INACTIVE]);
  vi.spyOn(connections, "catalogs").mockReturnValue(catalogs);
  vi.spyOn(connections, "scopes").mockReturnValue(scopes);
  vi.spyOn(scopes, "find").mockResolvedValue(GLOBAL_CONNECTION_SCOPE);
  vi.spyOn(catalogs, "find").mockImplementation(async (id) => ({
    ...emptyModelCatalog(),
    models: id === OPENROUTER.id ? [DECIDER, FLASH, CHAT] : [DECIDER],
  }));
  const settings = bareInstance(ChatDecisionSettingsRepository.prototype);
  const stored: { current: ChatDecisionSettings } = {
    current: {
      selection: null,
      rules: CONVERSATION_DEFAULT_DECISION_RULES,
      revision: 1,
    },
  };
  vi.spyOn(settings, "read").mockImplementation(async () => stored.current);
  const save = vi.spyOn(settings, "save").mockResolvedValue();
  const groups = bareInstance(UserGroupRepository.prototype);
  vi.spyOn(groups, "findIdsByMember").mockResolvedValue([]);
  return {
    service: new ChatDecisionSettingsService({
      settings,
      connections,
      groups,
      isSimulation,
    }),
    stored,
    save,
  };
}

const DECIDER_SELECTION: AgentModelSelection = {
  connectionId: "openrouter",
  model: DECIDER.id,
  reasoningEffort: null,
};

let context: ReturnType<typeof world>;
beforeEach(() => {
  context = world();
});

describe("administration", () => {
  it("offers only the OpenRouter decision models, not chat models or other providers", async () => {
    const view = await context.service.administration(ADMIN);
    expect(view.models.map((model) => model.model)).toEqual([
      DECIDER.id,
      FLASH.id,
    ]);
    expect(view.models.every((model) => model.connectionId === "openrouter")).toBe(
      true,
    );
    expect(view.status).toBe("noModel");
    expect(view.settings.rules).toEqual(CONVERSATION_DEFAULT_DECISION_RULES);
  });

  it("reports a saved model the catalog no longer lists as unavailable", async () => {
    context.stored.current = {
      ...context.stored.current,
      selection: { ...DECIDER_SELECTION, model: "perplexity/gone" },
    };
    expect((await context.service.administration(ADMIN)).status).toBe(
      "modelUnavailable",
    );
    context.stored.current = {
      ...context.stored.current,
      selection: DECIDER_SELECTION,
    };
    expect((await context.service.administration(ADMIN)).status).toBe("ready");
  });

  it("offers the simulated model only while the simulation is on", async () => {
    const simulated = world(true);
    const view = await simulated.service.administration(ADMIN);
    expect(view.models.at(-1)?.isSimulation).toBe(true);
  });

  it("is for administrators in the admin mode only", async () => {
    await expect(context.service.administration(EMPLOYEE)).rejects.toThrow();
  });
});

describe("save", () => {
  const rules = {
    answerThreshold: 70,
    responsibilityThreshold: 55,
    secondThreshold: 35,
    maximumResponders: 3,
  };

  it("stores a listed decision model with the default thresholds", async () => {
    await context.service.save(ADMIN, {
      selection: DECIDER_SELECTION,
      rules,
      revision: 1,
    });
    expect(context.save).toHaveBeenCalledWith({
      selection: DECIDER_SELECTION,
      rules,
      revision: 1,
    });
  });

  it("clears the model with a null choice", async () => {
    await context.service.save(ADMIN, { selection: null, rules, revision: 1 });
    expect(context.save).toHaveBeenCalledWith({
      selection: null,
      rules,
      revision: 1,
    });
  });

  it.each([
    ["a chat model", { ...DECIDER_SELECTION, model: CHAT.id }, "provider_model_not_found"],
    [
      "a decision model of a connection that does not list it",
      { connectionId: "google", model: FLASH.id, reasoningEffort: null },
      "provider_model_not_found",
    ],
    [
      "a reasoning level",
      { ...DECIDER_SELECTION, reasoningEffort: "high" },
      "profile_invalid",
    ],
  ])("refuses %s", async (_name, selection, code) => {
    await expect(
      context.service.save(ADMIN, { selection, rules, revision: 1 }),
    ).rejects.toMatchObject({ code });
    expect(context.save).not.toHaveBeenCalled();
  });

  it.each([
    { ...rules, answerThreshold: 101 },
    { ...rules, secondThreshold: -1 },
    { ...rules, responsibilityThreshold: 50.5 },
    { ...rules, maximumResponders: 0 },
    { ...rules, maximumResponders: 4 },
  ])("refuses rules out of range: %j", async (invalid) => {
    await expect(
      context.service.save(ADMIN, {
        selection: DECIDER_SELECTION,
        rules: invalid,
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: "profile_invalid" });
    expect(context.save).not.toHaveBeenCalled();
  });

  it("refuses everyone but an administrator", async () => {
    await expect(
      context.service.save(EMPLOYEE, { selection: null, rules, revision: 1 }),
    ).rejects.toThrow();
    expect(context.save).not.toHaveBeenCalled();
  });
});

describe("what decides now", () => {
  it("resolves nothing while no model is chosen or the chosen one is no longer listed", async () => {
    await expect(context.service.resolve()).resolves.toBeNull();
    await expect(context.service.modelView()).resolves.toEqual({
      status: "noModel",
      name: null,
    });
    context.stored.current = {
      ...context.stored.current,
      selection: { ...DECIDER_SELECTION, model: "perplexity/gone" },
    };
    await expect(context.service.resolve()).resolves.toBeNull();
    await expect(context.service.modelView()).resolves.toEqual({
      status: "modelUnavailable",
      name: "perplexity/gone",
    });
  });

  it("resolves the chosen decision model with its connection, names it and gives the default rules", async () => {
    context.stored.current = {
      ...context.stored.current,
      selection: DECIDER_SELECTION,
    };
    await expect(context.service.resolve()).resolves.toEqual({
      connectionId: "openrouter",
      model: DECIDER.id,
    });
    const view = await context.service.modelView();
    expect(view.status).toBe("ready");
    expect(view.name).toContain("Perplexity Decider V1.3");
    await expect(context.service.rules()).resolves.toEqual(
      CONVERSATION_DEFAULT_DECISION_RULES,
    );
  });
});
