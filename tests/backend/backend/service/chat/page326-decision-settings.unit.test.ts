import { expect, it, vi } from "vitest";

import { ChatDecisionSettingsService } from "@/backend/service/chat/ChatDecisionSettingsService";
import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";
import { CONVERSATION_DEFAULT_DECISION_RULES } from "@/definition/ConversationDecision";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { textInput } from "../../agents/parsers/text-provider-input";

import type { AccountAccess } from "@/definition/Authorization";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type {
  ChatDecisionEmptyReason,
  ChatDecisionSettings,
} from "@/definition/ConversationDecision";

const administrator: AccountAccess = {
  userId: "admin",
  role: null,
  isAdmin: true,
  isAgent: false,
  mode: "admin",
  firstName: "Admin",
  lastName: "User",
  isActive: true,
  departments: [],
  managedDepartments: [],
  allDepartments: true,
  allProjects: true,
  hasHadDepartment: false,
};
const assignment = textInput().agent;
const connection = {
  ...assignment.connection,
  provider: "openrouter" as const,
};
const catalogModel: AgentCatalogModel = {
  id: assignment.model,
  name: "Text model",
  contextWindow: null,
  promptPrice: null,
  completionPrice: null,
  isFree: false,
  reasoning: "none",
  reasoningEfforts: [],
  defaultReasoningEffort: null,
  isToolCapable: false,
  outputModalities: ["decisions"],
};
const model = {
  ...catalogModelChoice(connection, catalogModel),
  isChatCapable: undefined,
  isDecisionCapable: true,
};
const selection = {
  connectionId: assignment.connection.id,
  model: assignment.model,
  reasoningEffort: null,
};

function fixture(
  saved: ChatDecisionSettings["selection"] = null,
  issue: ChatDecisionEmptyReason | null = null,
): {
  readonly service: ChatDecisionSettingsService;
  readonly save: ReturnType<typeof vi.fn>;
} {
  let settings: ChatDecisionSettings = {
    selection: saved,
    rules: CONVERSATION_DEFAULT_DECISION_RULES,
    revision: 1,
  };
  const save = vi.fn(async (next: ChatDecisionSettings) => {
    settings = { ...next, revision: next.revision + 1 };
  });
  return {
    save,
    service: new ChatDecisionSettingsService({
      settings: partial({ read: async () => settings, save }),
      connections: partial({
        list: async () => (issue === "noConnections" ? [] : [connection]),
        scopes: () =>
          partial({
            find: async () => ({
              mode: issue === "noVisibleConnections" ? "restricted" : "global",
              targets: [],
            }),
          }),
        checks: () =>
          partial({
            find: async () => ({
              status: issue === "connectionUnavailable" ? "failed" : "passed",
            }),
          }),
        catalogs: () =>
          partial({
            find: async () => ({
              ...emptyModelCatalog(),
              models:
                issue === "emptyCatalog" || issue === "connectionUnavailable"
                  ? []
                  : [
                      {
                        ...catalogModel,
                        outputModalities:
                          issue === "noTextModels" ? ["text"] : ["decisions"],
                      },
                    ],
            }),
          }),
      }),
      groups: { findIdsByMember: async () => [] },
      isSimulation: false,
    }),
  };
}

it("lets an active administrator select an OpenRouter decision model without tools and shows ready", async () => {
  const { service, save } = fixture();
  expect((await service.administration(administrator)).models).toEqual([model]);
  const input = {
    selection,
    rules: CONVERSATION_DEFAULT_DECISION_RULES,
    revision: 1,
  };
  await service.save(administrator, input);
  expect(save).toHaveBeenCalledWith(input);
  expect(await service.administration(administrator)).toMatchObject({
    status: "ready",
    settings: { selection },
  });
  expect(await service.resolve()).toEqual({
    connectionId: selection.connectionId,
    model: selection.model,
  });
  expect(await service.currentStatus()).toBe("ready");
});

it("rejects role mode and unsuitable submitted choices at the server boundary", async () => {
  const { service, save } = fixture();
  await expect(
    service.administration({ ...administrator, mode: "role" }),
  ).rejects.toThrow();
  await expect(
    service.save(
      { ...administrator, isAdmin: false },
      { selection, rules: CONVERSATION_DEFAULT_DECISION_RULES, revision: 1 },
    ),
  ).rejects.toThrow();
  await expect(
    service.save(administrator, {
      selection: { ...selection, model: "unknown" },
      rules: CONVERSATION_DEFAULT_DECISION_RULES,
      revision: 1,
    }),
  ).rejects.toMatchObject({ code: "provider_model_not_found" });
  expect(save).not.toHaveBeenCalled();
});

it("explains an empty usable catalog and reports missing and unavailable runtime selections", async () => {
  const { service } = fixture(null, "noTextModels");
  expect(await service.administration(administrator)).toMatchObject({
    status: "noModel",
    emptyReason: "noTextModels",
  });
  expect(await service.currentStatus()).toBe("noModel");
  const saved = fixture(selection, "noTextModels").service;
  expect(await saved.currentStatus()).toBe("modelUnavailable");
});

it.each([
  "noConnections",
  "noVisibleConnections",
  "connectionUnavailable",
  "emptyCatalog",
  "noTextModels",
] as const)(
  "reports the actual %s cause instead of an unexplained empty picker",
  async (issue) => {
    expect(
      await fixture(null, issue).service.administration(administrator),
    ).toMatchObject({ emptyReason: issue, models: [] });
  },
);
