import { beforeEach, expect, it, vi } from "vitest";

import { ChatDecisionSettingsService } from "@/backend/service/chat/ChatDecisionSettingsService";
import { connectionModels } from "@/backend/service/agents/AgentConnectionModels";
import { resolveAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { textInput } from "../../agents/parsers/text-provider-input";

import type { AccountAccess } from "@/definition/Authorization";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type {
  ChatDecisionEmptyReason,
  ChatDecisionSettings,
} from "@/definition/ConversationDecision";

vi.mock("@/backend/service/agents/AgentConnectionModels", () => ({
  connectionModels: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentAssignmentResolution", () => ({
  resolveAgentAssignment: vi.fn(),
}));

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
};
const model = catalogModelChoice(assignment.connection, catalogModel);
const selection = {
  connectionId: assignment.connection.id,
  model: assignment.model,
  reasoningEffort: null,
};

beforeEach(() => {
  vi.mocked(connectionModels).mockResolvedValue([model]);
  vi.mocked(resolveAgentAssignment).mockResolvedValue(assignment);
});

function fixture(
  saved: ChatDecisionSettings["selection"] = null,
  issue: ChatDecisionEmptyReason | null = null,
): {
  readonly service: ChatDecisionSettingsService;
  readonly save: ReturnType<typeof vi.fn>;
} {
  let settings: ChatDecisionSettings = { selection: saved, revision: 1 };
  const save = vi.fn(async (next: ChatDecisionSettings) => {
    settings = { ...next, revision: next.revision + 1 };
  });
  return {
    save,
    service: new ChatDecisionSettingsService({
      settings: partial({ read: async () => settings, save }),
      connections: partial({
        list: async () =>
          issue === "noConnections" ? [] : [assignment.connection],
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
              models: issue === "emptyCatalog" ? [] : [catalogModel],
            }),
          }),
      }),
      groups: { findIdsByMember: async () => [] },
    }),
  };
}

it("lets an active administrator select a direct API text model without tools and shows ready", async () => {
  const { service, save } = fixture();
  expect((await service.administration(administrator)).models).toEqual([model]);
  await service.save(administrator, { selection, revision: 1 });
  expect(save).toHaveBeenCalledWith({ selection, revision: 1 });
  expect(await service.administration(administrator)).toMatchObject({
    status: "ready",
    settings: { selection },
  });
  expect(await service.resolve()).toEqual(assignment);
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
      { selection, revision: 1 },
    ),
  ).rejects.toThrow();
  vi.mocked(connectionModels).mockResolvedValue([
    { ...model, isSpeechOutputCapable: true },
  ]);
  await expect(
    service.save(administrator, { selection, revision: 1 }),
  ).rejects.toMatchObject({ code: "provider_model_not_found" });
  expect(save).not.toHaveBeenCalled();
});

it("explains an empty usable catalog and reports missing and unavailable runtime selections", async () => {
  vi.mocked(connectionModels).mockResolvedValue([]);
  const { service } = fixture();
  expect(await service.administration(administrator)).toMatchObject({
    status: "noModel",
    emptyReason: "noTextModels",
  });
  expect(await service.currentStatus()).toBe("noModel");
  const saved = fixture(selection).service;
  vi.mocked(resolveAgentAssignment).mockRejectedValue(
    new AgentExecutionError("connectionUnavailable"),
  );
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
    vi.mocked(connectionModels).mockResolvedValue([]);
    expect(
      await fixture(null, issue).service.administration(administrator),
    ).toMatchObject({ emptyReason: issue, models: [] });
  },
);
