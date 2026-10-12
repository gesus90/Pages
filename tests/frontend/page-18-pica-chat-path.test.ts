import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const application = vi.hoisted(() => ({ services: undefined as unknown }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => application.services,
}));

import { createI18n } from "@/app/lib/i18n";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";

import { createCatalogModel } from "../helpers/agents";
import {
  completion,
  loadAgentsPanel,
  openRouterModel,
  PICA_DUMMY_MARKER,
  PICA_DUMMY_MODELS,
  PICA_SYNTHETIC_KEY,
  picaProfile,
  sendChatIntent,
  submitAgentsForm,
  usePicaApplication,
} from "../helpers/pica-chat-path";

import type {
  PicaApplication,
  PicaSelection,
  RouteResult,
} from "../helpers/pica-chat-path";

const createApplication = usePicaApplication();

async function start(chatTimeoutMs?: number): Promise<PicaApplication> {
  const app = await createApplication({ chatTimeoutMs });
  application.services = app.services;
  return app;
}

afterEach(() => {
  application.services = undefined;
});

/** Reads Pica's saved selection back from the agents panel, as the browser receives it. */
async function loadPica(app: PicaApplication) {
  const panel = await loadAgentsPanel(app.admin);
  if (panel.data.access !== "granted") throw new Error("No admin access.");
  const pica = panel.data.profiles.filter((profile) =>
    profile.targets.some(
      (target) => target.kind === "system" && target.targetId === "chat",
    ),
  );
  expect(pica).toHaveLength(1);
  const connection = panel.data.connections.find(
    (entry) => entry.id === pica[0].connectionId,
  );
  return {
    id: pica[0].id,
    provider: connection?.provider,
    connectionId: pica[0].connectionId,
    model: pica[0].model,
    reasoningEffort: pica[0].reasoningEffort,
    text: panel.text,
  };
}

function answerOf(result: RouteResult): unknown {
  expect(result.status).toBe(200);
  const reply = result.body.reply;
  if (typeof reply !== "object" || reply === null) return undefined;
  const answer: unknown = Object.fromEntries(Object.entries(reply)).answer;
  if (typeof answer !== "object" || answer === null) return undefined;
  return Object.fromEntries(Object.entries(answer)).content;
}

/** The roles of the stored messages of the person's open session. */
async function storedRoles(app: PicaApplication): Promise<readonly string[]> {
  const opened = await sendChatIntent(app.admin, { intent: "open" });
  return JSON.parse(opened.text).overview.messages.map(
    (message: { role: string }) => message.role,
  );
}

describe("PAGE-18 AK-1: Pica's selection survives saving and loading", () => {
  it("loads exactly the saved provider, model and effort, without credentials", async () => {
    const app = await start();
    const connectionId = await app.connectOpenRouter();
    const selection: PicaSelection = {
      connectionId,
      model: "vendor/pica-chat",
      reasoningEffort: "high",
    };
    const created = await app.savePica(selection);
    expect(created.body).toEqual({ ok: true, intent: "save-profile" });
    const loaded = await loadPica(app);
    expect(loaded).toMatchObject({
      provider: "openrouter",
      connectionId,
      model: "vendor/pica-chat",
      reasoningEffort: "high",
    });
    expect(loaded.text).not.toContain(PICA_SYNTHETIC_KEY);

    // A changed selection replaces the saved one; reloading shows the change.
    const changed = await app.savePica(
      {
        connectionId,
        model: "poolside/laguna-s-2.1:free",
        reasoningEffort: null,
      },
      loaded.id,
    );
    expect(changed.status).toBe(200);
    expect(await loadPica(app)).toMatchObject({
      id: loaded.id,
      provider: "openrouter",
      model: "poolside/laguna-s-2.1:free",
      reasoningEffort: null,
    });
    expect(created.text + changed.text).not.toContain(PICA_SYNTHETIC_KEY);
  });
});

describe("PAGE-18 AK-2/AK-3: the chat runs exactly the saved selection", () => {
  it("answers through the settings and chat routes with the marker of the dummy provider", async () => {
    const app = await start();
    const connectionId = await app.connectOpenRouter();
    await app.savePica({
      connectionId,
      model: "vendor/pica-chat",
      reasoningEffort: "high",
    });
    expect(await loadPica(app)).toMatchObject({
      model: "vendor/pica-chat",
      reasoningEffort: "high",
    });

    const result = await app.ask(app.admin, "Synthetische Frage an Pica.");

    expect(answerOf(result)).toBe(PICA_DUMMY_MARKER);
    const calls = app.provider.completions();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://openrouter.ai/api/v1/chat/completions",
      method: "POST",
      isAuthenticated: true,
    });
    expect(calls[0].body).toMatchObject({
      model: "vendor/pica-chat",
      reasoning: { effort: "high" },
      provider: { allow_fallbacks: false },
    });
    expect(await storedRoles(app)).toEqual(["user", "assistant"]);
  });

  it("never replaces the saved selection with a test model, catalog default or another agent", async () => {
    const app = await start();
    const connectionId = await app.connectOpenRouter();
    // Decoys: the access's test model, the catalog's default effort, an
    // agent of the text assistant and the chat's own settings.
    const panel = await loadAgentsPanel(app.admin);
    if (panel.data.access !== "granted") throw new Error("No admin access.");
    expect(panel.data.connections[0].testModel).toBe("openrouter/free");
    expect(
      panel.data.catalogs[connectionId].models.find(
        (model) => model.id === "vendor/pica-chat",
      )?.defaultReasoningEffort,
    ).toBe("medium");
    const textAgent = await submitAgentsForm(app.admin, {
      intent: "save-profile",
      profileId: "",
      profile: JSON.stringify({
        ...picaProfile({
          connectionId,
          model: "vendor/pica-other",
          reasoningEffort: "low",
        }),
        name: "Text",
        purposes: ["text"],
        targets: [{ kind: "system", targetId: "text" }],
      }),
    });
    expect(textAgent.status).toBe(200);
    await app.services.chatSettingsService.update(app.admin, {
      attachmentLimitMegabytes: 8,
      systemInstruction: "# Pica\n\nSynthetische Anweisung.",
    });
    const saved = await app.savePica({
      connectionId,
      model: "vendor/pica-chat",
      reasoningEffort: "low",
    });
    expect(saved.status).toBe(200);

    expect(answerOf(await app.ask(app.writer, "Erste Frage."))).toBe(
      PICA_DUMMY_MARKER,
    );
    const [first] = app.provider.completions();
    expect(first.body).toMatchObject({
      model: "vendor/pica-chat",
      reasoning: { effort: "low" },
    });

    // The next message uses the newly saved selection, without a restart.
    const pica = await loadPica(app);
    await app.savePica(
      {
        connectionId,
        model: "poolside/laguna-s-2.1:free",
        reasoningEffort: null,
      },
      pica.id,
    );
    expect(answerOf(await app.ask(app.writer, "Zweite Frage."))).toBe(
      PICA_DUMMY_MARKER,
    );
    const second = app.provider.completions()[1];
    expect(second.body?.model).toBe("poolside/laguna-s-2.1:free");
    expect(second.body).not.toHaveProperty("reasoning");
    expect(app.provider.completions()).toHaveLength(2);
  });
});

describe("PAGE-18 AK-4: failures are named instead of empty or apparent answers", () => {
  const texts = { de: createI18n("de"), en: createI18n("en") };

  /** Sends a message and expects a translated failure and no stored answer. */
  async function expectFailure(
    app: PicaApplication,
    status: number,
    code: string,
  ): Promise<void> {
    const result = await app.ask(app.admin, "Synthetische Frage.");
    expect(result.status).toBe(status);
    expect(result.body).toEqual({ ok: false, error: code });
    for (const i18n of Object.values(texts)) {
      expect(i18n.exists(`chat.error.${code}`)).toBe(true);
      expect(i18n.t(`chat.error.${code}`)).not.toBe(
        i18n.t("chat.error.general"),
      );
    }
    expect(await storedRoles(app)).not.toContain("assistant");
  }

  async function startWithPica(chatTimeoutMs?: number) {
    const app = await start(chatTimeoutMs);
    const connectionId = await app.connectOpenRouter();
    await app.savePica({
      connectionId,
      model: "vendor/pica-chat",
      reasoningEffort: "high",
    });
    return { app, connectionId };
  }

  it("names a missing or ambiguous chat agent before any provider call", async () => {
    const app = await start();
    const connectionId = await app.connectOpenRouter();
    await expectFailure(app, 400, "roleMissing");
    const selection = {
      connectionId,
      model: "vendor/pica-chat",
      reasoningEffort: "high",
    };
    expect((await app.savePica(selection)).status).toBe(200);
    // The system function Chat takes exactly one agent.
    const second = await app.savePica({
      ...selection,
      model: "vendor/pica-other",
    });
    expect(second.body).toMatchObject({
      ok: false,
      error: "system_function_in_use",
    });
    expect(
      texts.de.exists("settings.agents.error.system_function_in_use"),
    ).toBe(true);
    // Two agents assigned to the same person with the same rank stay ambiguous.
    for (const name of ["Pica für Ada", "Pica auch für Ada"]) {
      const personal = await submitAgentsForm(app.admin, {
        intent: "save-profile",
        profileId: "",
        profile: JSON.stringify({
          ...picaProfile(selection),
          name,
          targets: [{ kind: "person", targetId: app.admin.id }],
          configuration: {
            ...picaProfile(selection).configuration,
            scope: "person",
            accessMode: "personal",
          },
        }),
      });
      expect(personal.status).toBe(200);
    }
    await expectFailure(app, 400, "profileSelectionRequired");
    expect(app.provider.completions()).toHaveLength(0);
  });

  it("refuses an invalid selection instead of saving or using it", async () => {
    const app = await start();
    const connectionId = await app.connectOpenRouter();
    for (const selection of [
      { connectionId, model: "vendor/unknown", reasoningEffort: "high" },
      { connectionId, model: "vendor/pica-chat", reasoningEffort: "ultra" },
      { connectionId, model: "vendor/pica-chat", reasoningEffort: null },
    ]) {
      const refused = await app.savePica(selection);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.body.ok).toBe(false);
    }
    await expectFailure(app, 400, "roleMissing");
  });

  it("names a saved model or effort that the catalog no longer offers", async () => {
    const { app, connectionId } = await startWithPica();
    const refresh = { intent: "refresh-catalog", connectionId };
    app.provider.models = PICA_DUMMY_MODELS.filter(
      (model) => model.id !== "vendor/pica-chat",
    );
    await submitAgentsForm(app.admin, refresh);
    await expectFailure(app, 400, "modelUnavailable");
    app.provider.models = [openRouterModel("vendor/pica-chat", ["low"])];
    await submitAgentsForm(app.admin, refresh);
    await expectFailure(app, 400, "reasoningUnsupported");
    expect(app.provider.completions()).toHaveLength(0);
  });

  it("names unreadable and missing credentials", async () => {
    const { app, connectionId } = await startWithPica();
    const parameters = { id: connectionId };
    // A key that no longer decrypts, for example after the instance key changed.
    await app.database.execute(
      "UPDATE agent_connections SET secret_encrypted = 'unreadable' WHERE id = $id;",
      parameters,
    );
    await expectFailure(app, 400, "connectionUnavailable");
    expect(app.provider.completions()).toHaveLength(0);

    // A CLI access whose account was signed out has no credentials left.
    const connections = new AgentConnectionRepository(app.database);
    const codexId = randomUUID();
    await connections.insert({
      id: codexId,
      name: "OpenAI Codex",
      provider: "codex_cli",
      secretEncrypted: null,
      testModel: null,
      actorId: app.admin.id,
    });
    await app.database.execute(
      "UPDATE agent_connections SET cli_logged_in_at = '2026-10-12T08:00:00Z' WHERE id = $id;",
      { id: codexId },
    );
    await connections.catalogs().save(
      codexId,
      {
        attemptedAt: "2026-10-12T08:00:00Z",
        errorCode: null,
        models: [
          createCatalogModel({
            id: "gpt-6-luna",
            reasoning: "levels",
            reasoningEfforts: ["low", "medium", "high"],
          }),
        ],
      },
      null,
    );
    const pica = await submitAgentsForm(app.admin, {
      intent: "save-profile",
      profileId: "",
      profile: JSON.stringify({
        ...picaProfile({
          connectionId: codexId,
          model: "gpt-6-luna",
          reasoningEffort: "medium",
        }),
        name: "Pica Codex",
        targets: [{ kind: "person", targetId: app.admin.id }],
        configuration: {
          ...picaProfile({
            connectionId: codexId,
            model: "gpt-6-luna",
            reasoningEffort: "medium",
          }).configuration,
          scope: "person",
          accessMode: "personal",
        },
      }),
    });
    expect(pica.status).toBe(200);
    await app.database.execute(
      "UPDATE agent_connections SET cli_logged_in_at = NULL WHERE id = $id;",
      { id: codexId },
    );
    await expectFailure(app, 400, "connectionUnavailable");
  });

  it("names an unverified or switched-off access", async () => {
    const { app, connectionId } = await startWithPica();
    await app.database.execute(
      "UPDATE agent_connection_checks SET status = 'failed', error_code = 'provider_auth_failed' WHERE connection_id = $id;",
      { id: connectionId },
    );
    await expectFailure(app, 400, "accessUnverified");
    const switchedOff = await submitAgentsForm(app.admin, {
      intent: "set-connection-active",
      connectionId,
      isActive: "false",
    });
    expect(switchedOff.status).toBe(200);
    await expectFailure(app, 400, "connectionUnavailable");
    expect(app.provider.completions()).toHaveLength(0);
  });

  it("names a provider that does not answer in time", async () => {
    const { app } = await startWithPica(1_500);
    app.provider.complete = (_body, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    await expectFailure(app, 504, "timeout");
    expect(app.provider.completions()).toHaveLength(1);
  });

  it.each([
    ["a server error", () => Response.json({ error: {} }, { status: 500 })],
    [
      "a rate limit",
      () => Response.json({ error: { code: 429 } }, { status: 429 }),
    ],
    [
      "an error wrapped in HTTP 200",
      () => Response.json({ error: { code: 502, message: "upstream" } }),
    ],
    [
      "a broken connection",
      () => Promise.reject(new TypeError("synthetic network failure")),
    ],
    ["a body that is no JSON", () => new Response("not json")],
  ])("names %s of the provider", async (_name, failure) => {
    const { app } = await startWithPica();
    app.provider.complete = failure;
    await expectFailure(app, 502, "providerFailed");
  });

  it.each([
    ["an empty answer", () => completion("")],
    ["a cut-off answer", () => completion(PICA_DUMMY_MARKER, "length")],
  ])("refuses %s instead of showing it", async (_name, reply) => {
    const { app } = await startWithPica();
    app.provider.complete = reply;
    await expectFailure(app, 400, "invalidOutput");
  });
});

describe("PAGE-18 AK-5: credentials stay on the server", () => {
  let logged: string[] = [];
  beforeEach(() => {
    logged = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => {
        logged.push(
          parts
            .map((part) =>
              part instanceof Error
                ? `${part.name} ${part.message} ${part.stack ?? ""}`
                : String(part),
            )
            .join(" "),
        );
      });
  });

  it("keeps the key out of panel data, chat answers, shown failures and logs", async () => {
    const app = await start();
    const connectionId = await app.connectOpenRouter();
    const responses: string[] = [];
    responses.push(
      (
        await app.savePica({
          connectionId,
          model: "vendor/pica-chat",
          reasoningEffort: "high",
        })
      ).text,
    );
    responses.push((await loadAgentsPanel(app.admin)).text);

    // The provider echoes the key in an answer, in an error and in a failure.
    app.provider.complete = () =>
      completion(`Echo ${PICA_SYNTHETIC_KEY} ${PICA_DUMMY_MARKER}`);
    const echoed = await app.ask(app.admin, "Synthetische Frage.");
    expect(String(answerOf(echoed))).toContain(PICA_DUMMY_MARKER);
    responses.push(echoed.text);
    app.provider.complete = () =>
      Response.json(
        { error: { message: `Invalid key ${PICA_SYNTHETIC_KEY}` } },
        { status: 401 },
      );
    responses.push((await app.ask(app.admin, "Zweite Frage.")).text);
    app.provider.complete = () =>
      Promise.reject(new Error(`socket closed for ${PICA_SYNTHETIC_KEY}`));
    responses.push((await app.ask(app.admin, "Dritte Frage.")).text);
    app.provider.complete = () => {
      throw new Error(`unexpected ${PICA_SYNTHETIC_KEY}`);
    };
    responses.push((await app.ask(app.admin, "Vierte Frage.")).text);
    responses.push(
      (await sendChatIntent(app.admin, { intent: "sessions" })).text,
    );
    responses.push((await sendChatIntent(app.admin, { intent: "open" })).text);

    for (const response of responses)
      expect(response).not.toContain(PICA_SYNTHETIC_KEY);
    expect(logged.join("\n")).not.toContain(PICA_SYNTHETIC_KEY);
    // The key reached the provider in its header only.
    for (const call of app.provider.calls) {
      expect(call.isAuthenticated).toBe(true);
      expect(call.url).not.toContain(PICA_SYNTHETIC_KEY);
      expect(JSON.stringify(call.body)).not.toContain(PICA_SYNTHETIC_KEY);
    }
    const stored = await app.database.query(
      "SELECT content FROM chat_messages;",
    );
    expect(JSON.stringify(stored)).not.toContain(PICA_SYNTHETIC_KEY);
    expect(app.provider.completions().length).toBeGreaterThanOrEqual(4);
  });
});
