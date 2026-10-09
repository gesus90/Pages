import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  administrationService: { getContext: vi.fn() },
  textAssistantService: {
    run: vi.fn(),
    validate: vi.fn(),
    history: vi.fn(),
    messages: vi.fn(),
    remove: vi.fn(),
    savePreferences: vi.fn(),
    cancel: vi.fn(),
  },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));
import { action } from "@/app/routes/text-assistant";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { textAssistantFailure } from "@/app/lib/text-assistant-response.server";
import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
} from "@/backend/error/WorkItemErrors";
import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { createUser } from "../helpers/factories";
import { createAccess } from "../helpers/authorization";

function args(
  input: unknown,
  options: {
    method?: string;
    origin?: string;
    authenticated?: boolean;
    raw?: string;
  } = {},
): Parameters<typeof action>[0] {
  const context = new RouterContextProvider();
  context.set(
    authenticatedUserContext,
    options.authenticated === false ? null : createUser(),
  );
  const method = options.method ?? "POST";
  return {
    request: new Request("https://pages.invalid/assistant-api", {
      method,
      headers: options.origin ? { Origin: options.origin } : {},
      body:
        method === "POST" ? (options.raw ?? JSON.stringify(input)) : undefined,
    }),
    context,
    params: {},
    url: new URL("https://pages.invalid/assistant-api"),
    pattern: "/assistant-api",
  };
}
const context = { kind: "wiki", id: "page", version: "1" };
beforeEach(() => {
  services.administrationService.getContext.mockResolvedValue(createAccess());
  services.textAssistantService.history.mockResolvedValue({
    conversations: [],
    preferences: { autoApply: false, targetLanguage: "de" },
  });
  services.textAssistantService.messages.mockResolvedValue([]);
  services.textAssistantService.run.mockResolvedValue({ text: "Completed" });
});

describe("explicit text assistant actions", () => {
  it("dispatches all intents with authenticated ownership and no cache", async () => {
    for (const intent of [
      "run",
      "validate",
      "history",
      "messages",
      "delete",
      "preferences",
      "cancel",
    ]) {
      const response = await action(
        args(
          {
            intent,
            request: { pinned: true },
            context,
            id: "conversation",
            preferences: { autoApply: true, targetLanguage: "fr" },
          },
          { origin: "https://pages.invalid" },
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ ok: true });
    }
    expect(services.textAssistantService.run).toHaveBeenCalledWith(
      createUser(),
      { pinned: true },
    );
    expect(services.textAssistantService.messages).toHaveBeenCalledWith(
      createUser(),
      context,
      "conversation",
    );
    expect(services.textAssistantService.cancel).toHaveBeenCalledWith(
      createUser(),
      "conversation",
    );
  });

  it("rejects unauthenticated/inactive/cross-origin requests and malformed external input", async () => {
    for (const options of [
      { authenticated: false },
      { origin: "https://outside.invalid" },
      { method: "GET" },
    ])
      expect(
        (await action(args({ intent: "history", context }, options))).status,
      ).toBeGreaterThanOrEqual(400);
    services.administrationService.getContext.mockResolvedValueOnce(
      createAccess({ isActive: false }),
    );
    expect((await action(args({ intent: "history", context }))).status).toBe(
      403,
    );
    for (const input of [
      {},
      { intent: "__proto__" },
      { intent: "messages", context: {} },
      { intent: "delete", id: "!" },
    ])
      expect((await action(args(input))).status).toBe(400);
    for (const raw of ["bad JSON", "x".repeat(500_001)])
      expect((await action(args({}, { raw }))).status).toBe(400);
    services.textAssistantService.run.mockRejectedValue(
      new Error("secret upstream diagnostic"),
    );
    const response = await action(args({ intent: "run", request: {} }));
    expect(await response.text()).not.toContain("secret upstream diagnostic");
  });

  it("maps authorization/context/conflict errors and preserves no-store on thrown responses", () => {
    for (const error of [
      new AgentAccessDeniedError(),
      new WikiAccessDeniedError(),
      new WorkItemAccessDeniedError(),
      new ProjectAccessDeniedError(),
    ])
      expect(textAssistantFailure(error).status).toBe(403);
    for (const error of [
      new WikiPageNotFoundError(),
      new WorkItemNotFoundError(),
      new ProjectNotFoundError(),
    ])
      expect(textAssistantFailure(error).status).toBe(404);
    for (const [code, status] of [
      ["accessDenied", 403],
      ["versionConflict", 409],
      ["cancelled", 400],
    ] as const)
      expect(textAssistantFailure(new TextAssistantError(code)).status).toBe(
        status,
      );
    const response = textAssistantFailure(
      new Response("Denied", {
        status: 403,
        headers: { "X-Test": "preserved" },
      }),
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Test")).toBe("preserved");
  });
});
