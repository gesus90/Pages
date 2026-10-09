import { describe, expect, it } from "vitest";

import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";
import { TextAssistantSettingsRepository } from "@/backend/database/repositories/assistant/TextAssistantSettingsRepository";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { createAccess } from "../helpers/authorization";
import { createCatalogModel } from "../helpers/agents";
import { createAssistantHarness } from "../helpers/text-assistant";
import { useMigratedDatabase } from "../helpers/test-database";

describe("Text function role and preferences", () => {
  const getDatabase = useMigratedDatabase();

  it("starts unassigned, persists a real model/effort and keeps personal preferences separate", async () => {
    const settings = new TextAssistantSettingsRepository(getDatabase());
    expect(await settings.read()).toEqual({ role: null, retentionDays: 30 });
    expect(await settings.preferences("alice")).toEqual({
      autoApply: false,
      targetLanguage: "de",
    });
    const harness = await createAssistantHarness(getDatabase());
    const role = {
      connectionId: "connection",
      model: "model-a",
      reasoningEffort: "medium",
    };
    expect(await harness.roles.read(harness.admin)).toEqual({
      role,
      retentionDays: 30,
    });
    expect(await harness.roles.resolve()).toMatchObject({
      model: "model-a",
      reasoningEffort: "medium",
      connection: { testModel: "other-default" },
    });
    await harness.service.savePreferences(harness.alice, {
      autoApply: true,
      targetLanguage: "fr",
    });
    await harness.service.savePreferences(harness.alice, {
      autoApply: false,
      targetLanguage: "en",
    });
    expect(await settings.preferences("alice")).toEqual({
      autoApply: false,
      targetLanguage: "en",
    });
    expect(await settings.preferences("bob")).toEqual({
      autoApply: false,
      targetLanguage: "de",
    });
    await harness.roles.save(harness.admin, { role: null, retentionDays: 1 });
    expect(await settings.read()).toEqual({ role: null, retentionDays: 1 });
    await expect(harness.roles.resolve()).rejects.toThrow("roleMissing");
  });

  it("enforces active administrator mode for configuration and reading", async () => {
    const { roles } = await createAssistantHarness(getDatabase());
    for (const actor of [
      createAccess(),
      createAccess({ isAdmin: true }),
      createAccess({ isAdmin: true, mode: "admin", isActive: false }),
    ]) {
      await expect(roles.read(actor)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
      await expect(
        roles.save(actor, { role: null, retentionDays: 30 }),
      ).rejects.toBeInstanceOf(AgentAccessDeniedError);
    }
  });

  it("rejects nonexistent/manual models, unlisted reasoning and unavailable credentials", async () => {
    const { roles, admin, connections } =
      await createAssistantHarness(getDatabase());
    for (const role of [
      { connectionId: "missing", model: "model-a", reasoningEffort: null },
      { connectionId: "connection", model: "manual", reasoningEffort: null },
      {
        connectionId: "connection",
        model: "model-a",
        reasoningEffort: "xhigh",
      },
    ])
      await expect(
        roles.save(admin, { role, retentionDays: 30 }),
      ).rejects.toBeInstanceOf(TextAssistantError);
    for (const retentionDays of [0, 366, NaN, 1.5])
      await expect(
        roles.save(admin, { role: null, retentionDays }),
      ).rejects.toThrow("invalidInput");
    await roles.save(admin, {
      role: {
        connectionId: "connection",
        model: "model-a",
        reasoningEffort: "low",
      },
      retentionDays: 365,
    });
    await connections.remove("connection");
    await expect(roles.resolve()).rejects.toThrow("connectionUnavailable");
  });

  it("switches to a logged-in CLI catalog and refuses logout or changed capabilities without fallback", async () => {
    const { roles, admin, connections } =
      await createAssistantHarness(getDatabase());
    await connections.insert({
      id: "cli",
      name: "CLI",
      provider: "codex_cli",
      secretEncrypted: null,
      testModel: null,
      actorId: "alice",
    });
    const role = {
      connectionId: "cli",
      model: "cli-model",
      reasoningEffort: "low",
    };
    await expect(
      roles.save(admin, { role, retentionDays: 30 }),
    ).rejects.toThrow("connectionUnavailable");
    await connections.setCliAccount(
      "cli",
      { loggedInAt: "2026-10-09T12:00:00Z", label: null },
      "alice",
    );
    await connections.catalogs().save(
      "cli",
      {
        attemptedAt: "2026-10-09T12:00:00Z",
        errorCode: null,
        models: [
          createCatalogModel({
            id: "cli-model",
            reasoning: "levels",
            reasoningEfforts: ["low"],
          }),
        ],
      },
      null,
    );
    await roles.save(admin, { role, retentionDays: 30 });
    expect(await roles.resolve()).toMatchObject({
      model: "cli-model",
      reasoningEffort: "low",
      connection: { provider: "codex_cli" },
    });
    await connections.catalogs().invalidate("cli");
    await expect(roles.resolve()).rejects.toThrow("modelUnavailable");
    await connections.setCliAccount(
      "cli",
      { loggedInAt: null, label: null },
      "alice",
    );
    await expect(roles.resolve()).rejects.toThrow("connectionUnavailable");
  });
});
