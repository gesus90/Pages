import { expect, it, vi } from "vitest";

import { ChatDecisionSettingsRepository } from "@/backend/database/repositories/chat/ChatDecisionSettingsRepository";
import { ChatDecisionSettingsService } from "@/backend/service/chat/ChatDecisionSettingsService";

import { bareInstance } from "../tasks/bare-instance";
import { ACTOR, modelWorld, ZEN } from "../employee/page347-model-fixture";

function decisionWorld(): {
  readonly service: ChatDecisionSettingsService;
  readonly settings: ChatDecisionSettingsRepository;
} {
  const { connections } = modelWorld();
  const settings = bareInstance(ChatDecisionSettingsRepository.prototype);
  vi.spyOn(settings, "read").mockResolvedValue({
    revision: 1,
    selection: {
      connectionId: "connection",
      model: ZEN.id,
      reasoningEffort: null,
    },
  });
  vi.spyOn(settings, "save").mockResolvedValue();
  const service = new ChatDecisionSettingsService({
    settings,
    connections,
    groups: { findIdsByMember: async () => [] },
  });
  return { service, settings };
}

it("lists all providers while a saved incompatible decision model remains unavailable", async () => {
  const { service } = decisionWorld();
  const view = await service.administration(ACTOR);
  expect(view.models.map((model) => model.provider)).toEqual([
    "opencode",
    "openai",
  ]);
  expect(view.status).toBe("modelUnavailable");
  await expect(service.resolve()).resolves.toBeNull();
});

it.each(["connection", "api"])(
  "refuses a forged decision model choice from %s before saving",
  async (connectionId) => {
    const { service, settings } = decisionWorld();
    await expect(
      service.save(ACTOR, {
        revision: 1,
        selection: { connectionId, model: ZEN.id, reasoningEffort: null },
      }),
    ).rejects.toMatchObject({ code: "provider_model_not_found" });
    expect(settings.save).not.toHaveBeenCalled();
  },
);
