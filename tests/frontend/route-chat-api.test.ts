import { Readable } from "node:stream";

import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  chatService: { send: vi.fn(), cancel: vi.fn() },
  chatSessionService: {
    open: vi.fn(),
    create: vi.fn(),
    list: vi.fn(),
    view: vi.fn(),
    remove: vi.fn(),
  },
  chatAttachmentService: { upload: vi.fn(), open: vi.fn(), discard: vi.fn() },
  chatSettingsService: { update: vi.fn() },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));
import { action } from "@/app/routes/chat-api";
import { action as upload } from "@/app/routes/chat-attachments";
import { loader as download } from "@/app/routes/chat-attachment";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { handleUpdateChatSettings } from "@/app/lib/settings-actions/settings-chat-actions.server";
import { ChatError } from "@/backend/error/ChatErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";

import { createUser } from "../helpers/factories";

import type { SettingsActionContext } from "@/app/lib/settings-actions/settings-action-support.server";

function context(isAuthenticated = true): RouterContextProvider {
  const provider = new RouterContextProvider();
  provider.set(authenticatedUserContext, isAuthenticated ? createUser() : null);
  return provider;
}

function post(
  body: unknown,
  options: {
    method?: string;
    origin?: string;
    raw?: string;
    user?: boolean;
  } = {},
): Parameters<typeof action>[0] {
  const method = options.method ?? "POST";
  return {
    request: new Request("https://pages.invalid/chat-api", {
      method,
      headers: options.origin ? { Origin: options.origin } : {},
      body:
        method === "GET" ? undefined : (options.raw ?? JSON.stringify(body)),
    }),
    context: context(options.user ?? true),
    params: {},
    url: new URL("https://pages.invalid/chat-api"),
    pattern: "/chat-api",
  };
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

beforeEach(() => {
  services.chatSessionService.open.mockResolvedValue({
    session: { id: "a-b-c-d-e" },
  });
  services.chatSessionService.create.mockResolvedValue({
    session: { id: "f-g-h-i-j" },
  });
  services.chatSessionService.list.mockResolvedValue([]);
  services.chatSessionService.view.mockResolvedValue({ messages: [] });
  services.chatService.send.mockResolvedValue({ answer: { content: "Hallo" } });
});

describe("A11.4: chat interface", () => {
  it("runs every intent for the signed-in person without caching", async () => {
    const intents = [
      [{ intent: "open" }, { overview: { session: { id: "a-b-c-d-e" } } }],
      [{ intent: "new" }, { view: { session: { id: "f-g-h-i-j" } } }],
      [{ intent: "sessions" }, { sessions: [] }],
      [
        { intent: "session", sessionId: "a-b-c-d-e" },
        { view: { messages: [] } },
      ],
      [
        { intent: "send", message: { text: "Hallo" } },
        { reply: { answer: { content: "Hallo" } } },
      ],
      [
        { intent: "delete", sessionId: "a-b-c-d-e", confirmation: "LÖSCHEN" },
        {},
      ],
      [{ intent: "discard", attachmentId: "file" }, {}],
      [{ intent: "cancel", requestId: "request" }, {}],
    ] as const;
    for (const [body, expected] of intents) {
      const response = await action(post(body));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await json(response)).toEqual({ ok: true, ...expected });
    }
    expect(services.chatSessionService.remove).toHaveBeenCalledWith(
      expect.objectContaining({ id: createUser().id }),
      "a-b-c-d-e",
      "LÖSCHEN",
    );
    expect(services.chatService.cancel).toHaveBeenCalledWith(
      expect.anything(),
      "request",
    );
  });

  it("rejects other methods, foreign origins, missing sessions and malformed bodies", async () => {
    const cases: readonly [Parameters<typeof action>[0], number, string][] = [
      [post({ intent: "open" }, { method: "PUT" }), 400, "invalidInput"],
      [
        post({ intent: "open" }, { origin: "https://evil.invalid" }),
        403,
        "accessDenied",
      ],
      [post({ intent: "open" }, { user: false }), 403, "accessDenied"],
      [post(null, { raw: "{" }), 400, "invalidInput"],
      [post(null, { raw: "x".repeat(100_001) }), 400, "invalidInput"],
      [post({ intent: "unknown" }), 400, "invalidInput"],
    ];
    for (const [request, status, error] of cases) {
      const response = await action(request);
      expect(response.status).toBe(status);
      expect(await json(response)).toEqual({ ok: false, error });
    }
  });

  it("maps failures to stable codes and never forwards messages", async () => {
    const failures: readonly [unknown, number, string][] = [
      [new ChatError("sessionMissing"), 404, "sessionMissing"],
      [new ChatError("fileTooLarge"), 413, "fileTooLarge"],
      [new TextAssistantError("requestBusy"), 409, "requestBusy"],
      [new TextAssistantError("roleMissing"), 400, "roleMissing"],
      [new TextAssistantError("providerFailed"), 502, "providerFailed"],
      [new TextAssistantError("timeout"), 504, "timeout"],
      [new Error("secret prompt text"), 500, "general"],
    ];
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const [failure, status, error] of failures) {
      services.chatService.send.mockRejectedValueOnce(failure);
      const response = await action(post({ intent: "send", message: {} }));
      expect(response.status).toBe(status);
      expect(await json(response)).toEqual({ ok: false, error });
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret prompt text");
  });

  it("streams uploads to the attachment service and refuses other methods", async () => {
    services.chatAttachmentService.upload.mockResolvedValue({ id: "file" });
    const request = new Request(
      "https://pages.invalid/chat-api/attachments?session=a-b-c-d-e&name=notes.txt",
      { method: "PUT", body: "Inhalt", headers: { "Content-Length": "6" } },
    );
    const response = await upload({
      request,
      context: context(),
      params: {},
      url: new URL(request.url),
      pattern: "/chat-api/attachments",
    });
    expect(await json(response)).toEqual({
      ok: true,
      attachment: { id: "file" },
    });
    expect(services.chatAttachmentService.upload).toHaveBeenCalledWith(
      expect.anything(),
      "a-b-c-d-e",
      expect.objectContaining({ fileName: "notes.txt", contentLength: 6 }),
    );
    const refused = await upload({
      request: new Request("https://pages.invalid/chat-api/attachments", {
        method: "POST",
      }),
      context: context(),
      params: {},
      url: new URL("https://pages.invalid/chat-api/attachments"),
      pattern: "/chat-api/attachments",
    });
    expect(refused.status).toBe(400);
  });

  it("sends attachments only as downloads that run nothing, and hides foreign ones", async () => {
    services.chatAttachmentService.open.mockResolvedValueOnce({
      attachment: {
        id: "file",
        fileName: "logo.svg",
        contentType: "image/svg+xml",
        size: 5,
      },
      stream: Readable.from([Buffer.from("<svg>")]),
    });
    const args = (attachmentId: string, isAuthenticated = true) => ({
      request: new Request(
        `https://pages.invalid/chat/attachments/${attachmentId}`,
      ),
      context: context(isAuthenticated),
      params: { attachmentId },
      url: new URL(`https://pages.invalid/chat/attachments/${attachmentId}`),
      pattern: "/chat/attachments/:attachmentId",
    });
    const response = await download(args("file"));
    expect(response.headers.get("Content-Disposition")).toContain(
      "attachment;",
    );
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("<svg>");
    services.chatAttachmentService.open.mockRejectedValueOnce(
      new ChatError("attachmentMissing"),
    );
    await expect(download(args("foreign"))).rejects.toMatchObject({
      status: 404,
    });
    await expect(download(args("file", false))).rejects.toMatchObject({
      status: 403,
    });
    services.chatAttachmentService.open.mockRejectedValueOnce(
      new Error("disk"),
    );
    await expect(download(args("broken"))).rejects.toThrow("disk");
  });
});

describe("A11.4: chat settings action", () => {
  function settingsContext(
    fields: Readonly<Record<string, string>>,
  ): SettingsActionContext {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    return {
      formData,
      user: createUser(),
      services: services as unknown as SettingsActionContext["services"],
      request: new Request("https://pages.invalid/settings/system", {
        method: "POST",
      }),
    };
  }

  it("stores limit and instruction, resets to the default and reports invalid input", async () => {
    const saved = await handleUpdateChatSettings(
      settingsContext({
        attachmentLimitMegabytes: "64",
        systemInstruction: "# Regeln",
      }),
    );
    expect(saved?.data).toEqual({ intent: "update-chat-settings", ok: true });
    expect(services.chatSettingsService.update).toHaveBeenLastCalledWith(
      expect.anything(),
      { attachmentLimitMegabytes: 64, systemInstruction: "# Regeln" },
    );
    await handleUpdateChatSettings(
      settingsContext({
        attachmentLimitMegabytes: "abc",
        resetInstruction: "true",
      }),
    );
    expect(services.chatSettingsService.update).toHaveBeenLastCalledWith(
      expect.anything(),
      { attachmentLimitMegabytes: Number.NaN, systemInstruction: null },
    );

    for (const [failure, error] of [
      [new ChatError("invalidSetting"), "invalidSetting"],
      [new ChatError("credentialsInText"), "credentialsInText"],
    ] as const) {
      services.chatSettingsService.update.mockRejectedValueOnce(failure);
      const result = await handleUpdateChatSettings(settingsContext({}));
      expect(result?.init?.status).toBe(400);
      expect(result?.data).toEqual({
        intent: "update-chat-settings",
        ok: false,
        error,
      });
    }
    services.chatSettingsService.update.mockRejectedValueOnce(
      new InstanceSettingsDeniedError(),
    );
    await expect(
      handleUpdateChatSettings(settingsContext({})),
    ).rejects.toMatchObject({
      status: 403,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    services.chatSettingsService.update.mockRejectedValueOnce(
      new Error("disk"),
    );
    const failed = await handleUpdateChatSettings(settingsContext({}));
    expect(failed?.init?.status).toBe(500);
  });
});
