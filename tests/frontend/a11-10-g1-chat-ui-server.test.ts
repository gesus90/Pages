import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { chatFailure } from "@/app/lib/chat-response.server";
import { handleUpdateChatSettings } from "@/app/lib/settings-actions/settings-chat-actions.server";
import { action as upload } from "@/app/routes/chat-attachments";

import { createUser } from "../helpers/factories";

import type { SettingsActionContext } from "@/app/lib/settings-actions/settings-action-support.server";

const services = vi.hoisted(() => ({
  chatAttachmentService: { upload: vi.fn() },
  chatSettingsService: { update: vi.fn() },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

function uploadArguments(
  address: string,
  isAuthenticated: boolean,
): Parameters<typeof upload>[0] {
  const request = new Request(address, { method: "PUT", body: "Inhalt" });
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, isAuthenticated ? createUser() : null);
  return {
    request,
    context,
    params: {},
    url: new URL(address),
    pattern: "/chat-api/attachments",
  };
}

function settingsContext(): SettingsActionContext {
  return {
    formData: new FormData(),
    user: createUser(),
    services: services as unknown as SettingsActionContext["services"],
    request: new Request("https://pages.invalid/settings/system", {
      method: "POST",
    }),
  };
}

describe("A11.10 g1: chat upload route", () => {
  it("refuses an upload without a signed-in person before the service runs", async () => {
    const response = await upload(
      uploadArguments(
        "https://pages.invalid/chat-api/attachments?session=a-b-c-d-e&name=x.txt",
        false,
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "accessDenied" });
    expect(services.chatAttachmentService.upload).not.toHaveBeenCalled();
  });

  it("passes an upload without a name and a session as empty and missing values", async () => {
    services.chatAttachmentService.upload.mockResolvedValue({ id: "file" });

    const response = await upload(
      uploadArguments("https://pages.invalid/chat-api/attachments", true),
    );

    expect(response.status).toBe(200);
    expect(services.chatAttachmentService.upload).toHaveBeenCalledWith(
      expect.objectContaining({ id: createUser().id }),
      null,
      expect.objectContaining({ fileName: "" }),
    );
  });

  it("answers a failure that is no error object with the general code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    services.chatAttachmentService.upload.mockRejectedValue("disk full");

    const response = await upload(
      uploadArguments(
        "https://pages.invalid/chat-api/attachments?session=a-b-c-d-e&name=x.txt",
        true,
      ),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "general" });
    expect(log).toHaveBeenCalledWith(
      "[pages] A chat request failed.",
      "string",
    );
  });
});

describe("A11.10 g1: chat failure response", () => {
  it("logs only the type of a thrown value and never its content", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = chatFailure({ secret: "prompt text" });

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, error: "general" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("prompt text");
    expect(log).toHaveBeenCalledWith(
      "[pages] A chat request failed.",
      "object",
    );
  });
});

describe("A11.10 g1: chat settings action", () => {
  it("answers a failure that is no error object with the general code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    services.chatSettingsService.update.mockRejectedValue("disk full");

    const result = await handleUpdateChatSettings(settingsContext());

    expect(result?.init?.status).toBe(500);
    expect(result?.data).toEqual({
      intent: "update-chat-settings",
      ok: false,
      error: "general",
    });
    expect(log).toHaveBeenCalledWith(
      "[pages] The chat settings could not be stored.",
      "string",
    );
  });
});
