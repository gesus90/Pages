import { expect, it, vi } from "vitest";

import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AgentCheckRepository } from "@/backend/database/repositories/agent/AgentCheckRepository";
import { AgentCatalogRepository } from "@/backend/database/repositories/agent/AgentCatalogRepository";
import { AgentConnectionScopeRepository } from "@/backend/database/repositories/agent/AgentConnectionScopeRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { PicaSettingsRepository } from "@/backend/database/repositories/chat/PicaSettingsRepository";
import { PicaSettingsService } from "@/backend/service/chat/PicaSettingsService";
import { picaSelectionAdoption } from "@/backend/service/chat/PicaSelectionAdoption";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";
import { isPicaModel } from "@/definition/PicaModelSelection";

import { bareInstance } from "../tasks/bare-instance";
import { ASSIGNMENT } from "./page48-chat-fixture";

import type { MockInstance } from "vitest";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentModelSelection } from "@/definition/AgentModelSelection";

const API: AgentConnectionRecord = {
  ...ASSIGNMENT.connection,
  id: "api",
  provider: "google_ai_studio",
  testModel: "models/gemini-flash",
};
const CLI: AgentConnectionRecord = {
  ...API,
  id: "cli",
  provider: "opencode",
  hasApiKey: false,
  cliLoggedInAt: "today",
  testModel: "google/gemini-flash",
};
const SELECTION: AgentModelSelection = {
  connectionId: API.id,
  model: "models/gemini-flash",
  reasoningEffort: "low",
};
const MODEL: PageAgentModel = {
  id: "cli:google/gemini-flash",
  connectionId: CLI.id,
  model: CLI.testModel ?? "",
  provider: "opencode",
  name: "Gemini",
  reasoning: "levels",
  reasoningEfforts: ["low", "high"],
  catalogDefaultReasoningEffort: null,
  reasoningEffort: null,
};

function selectionWorld(): {
  readonly service: PicaSettingsService;
  readonly connections: AgentConnectionRepository;
  readonly save: MockInstance<PicaSettingsRepository["save"]>;
  readonly stored: { selection: AgentModelSelection | null };
} {
  const connections = bareInstance(AgentConnectionRepository.prototype);
  const checks = bareInstance(AgentCheckRepository.prototype);
  const catalogs = bareInstance(AgentCatalogRepository.prototype);
  const scopes = bareInstance(AgentConnectionScopeRepository.prototype);
  vi.spyOn(connections, "list").mockResolvedValue([API, CLI]);
  vi.spyOn(connections, "find").mockImplementation(
    async (id) => [API, CLI].find((entry) => entry.id === id) ?? null,
  );
  vi.spyOn(connections, "checks").mockReturnValue(checks);
  vi.spyOn(connections, "catalogs").mockReturnValue(catalogs);
  vi.spyOn(connections, "scopes").mockReturnValue(scopes);
  vi.spyOn(checks, "find").mockResolvedValue({
    status: "passed",
    errorCode: null,
    checkedAt: "today",
    durationMs: 1,
    detail: {},
  });
  vi.spyOn(scopes, "find").mockResolvedValue(GLOBAL_CONNECTION_SCOPE);
  vi.spyOn(catalogs, "find").mockImplementation(async (id) => ({
    ...emptyModelCatalog(),
    models: [
      {
        id: id === API.id ? SELECTION.model : MODEL.model,
        name: "Gemini",
        contextWindow: null,
        promptPrice: null,
        completionPrice: null,
        isFree: false,
        reasoning: "levels",
        reasoningEfforts: ["low", "high"],
        defaultReasoningEffort: null,
      },
    ],
  }));
  const settings = bareInstance(PicaSettingsRepository.prototype);
  const stored: { selection: AgentModelSelection | null } = {
    selection: SELECTION,
  };
  vi.spyOn(settings, "read").mockImplementation(async () => ({
    isEnabled: true,
    selection: stored.selection,
    run: null,
    revision: 4,
    legacyChecked: true,
  }));
  const save = vi.spyOn(settings, "save").mockResolvedValue();
  const authorization = bareInstance(AuthorizationRepository.prototype);
  vi.spyOn(authorization, "snapshot").mockResolvedValue({
    roles: [],
    departments: [],
    accounts: [
      {
        userId: "owner",
        isActive: true,
        isAdmin: true,
        mode: "admin",
        role: null,
        firstName: "Owner",
        lastName: "",
        departments: [],
        managedDepartments: [],
        allDepartments: true,
        allProjects: true,
        hasHadDepartment: false,
      },
    ],
  });
  const groups = bareInstance(UserGroupRepository.prototype);
  vi.spyOn(groups, "findIdsByMember").mockResolvedValue([]);
  const profiles = bareInstance(AgentProfileRepository.prototype);
  return {
    service: new PicaSettingsService({
      settings,
      connections,
      profiles,
      authorization,
      groups,
    }),
    connections,
    save,
    stored,
  };
}

it("proposes an exact linked API model and effort without mutating settings or silently executing", async () => {
  const world = selectionWorld();
  const view = await world.service.administration("owner");
  expect(view.models.every(isPicaModel)).toBe(true);
  expect(view.settings.selection).toEqual(SELECTION);
  expect(view.settings.adoption).toMatchObject({
    connectionId: CLI.id,
    model: MODEL.model,
    reasoningEffort: "low",
  });
  expect(view.settings.error).toBe("picaModelSelectionRequired");
  expect(world.save).not.toHaveBeenCalled();
  await expect(world.service.resolve("owner")).rejects.toMatchObject({
    code: "picaModelSelectionRequired",
  });
  await world.service.save("owner", {
    isEnabled: true,
    revision: 4,
    selection: { ...SELECTION, connectionId: CLI.id, model: MODEL.model },
  });
  expect(world.save).toHaveBeenCalledWith(
    expect.objectContaining({
      selection: { ...SELECTION, connectionId: CLI.id, model: MODEL.model },
    }),
  );
});

it("requires a new selection for unavailable, ambiguous or incompatible opencode matches", async () => {
  const { connections } = selectionWorld();
  expect(await picaSelectionAdoption(connections, SELECTION, [])).toBeNull();
  expect(
    await picaSelectionAdoption(connections, SELECTION, [
      MODEL,
      { ...MODEL, connectionId: "other" },
    ]),
  ).toBeNull();
  expect(
    await picaSelectionAdoption(
      connections,
      { ...SELECTION, reasoningEffort: "max" },
      [MODEL],
    ),
  ).toBeNull();
  vi.spyOn(connections, "find").mockResolvedValue({
    ...API,
    provider: "openai",
  });
  expect(
    await picaSelectionAdoption(connections, SELECTION, [MODEL]),
  ).toBeNull();
});

it("hides free Zen only in Pica while retaining free OpenRouter and CLI choices", () => {
  expect(isPicaModel({ ...MODEL, model: "opencode/free", isFree: true })).toBe(
    false,
  );
  expect(
    isPicaModel({
      ...MODEL,
      model: "openrouter/provider/free:free",
      isFree: true,
    }),
  ).toBe(true);
  expect(
    isPicaModel({ ...MODEL, provider: "codex_cli", model: "gpt-6-luna" }),
  ).toBe(true);
  expect(isPicaModel({ ...MODEL, provider: "openai" })).toBe(false);
});

it("refuses a saved or newly submitted free Zen choice server-side without replacing it", async () => {
  const world = selectionWorld();
  world.stored.selection = {
    connectionId: CLI.id,
    model: "opencode/free",
    reasoningEffort: null,
  };
  vi.spyOn(world.connections.catalogs(), "find").mockImplementation(
    async () => ({
      ...emptyModelCatalog(),
      models: [
        {
          id: "opencode/free",
          name: "Free Zen",
          contextWindow: null,
          promptPrice: "0",
          completionPrice: "0",
          isFree: true,
          reasoning: "none",
          reasoningEfforts: [],
          defaultReasoningEffort: null,
        },
      ],
    }),
  );
  await expect(world.service.resolve("owner")).rejects.toMatchObject({
    code: "picaZenUnsupported",
  });
  const view = await world.service.administration("owner");
  expect(view.settings.selection).toEqual(world.stored.selection);
  expect(view.settings.error).toBe("picaZenUnsupported");
  expect(view.models.some((entry) => entry.model === "opencode/free")).toBe(
    false,
  );
  await expect(
    world.service.save("owner", {
      isEnabled: true,
      revision: 4,
      selection: world.stored.selection,
    }),
  ).rejects.toMatchObject({ code: "picaZenUnsupported" });
  expect(world.save).not.toHaveBeenCalled();
});

it("explains an earlier API-only choice even when its access check no longer passes", async () => {
  const world = selectionWorld();
  vi.spyOn(world.connections.checks(), "find").mockResolvedValue({
    status: "failed",
    errorCode: "provider_auth_failed",
    checkedAt: "today",
    durationMs: 1,
    detail: {},
  });
  const view = await world.service.administration("owner");
  expect(view.settings.selection).toEqual(SELECTION);
  expect(view.settings.error).toBe("picaModelSelectionRequired");
  expect(view.settings.adoption).toBeUndefined();
  await expect(world.service.resolve("owner")).rejects.toMatchObject({
    code: "picaModelSelectionRequired",
  });
  expect(world.save).not.toHaveBeenCalled();
});
