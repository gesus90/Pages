import { describe, expect, it, vi } from "vitest";

import { ChatError } from "@/backend/error/ChatErrors";
import { PagesPicaMobileChat } from "@/backend/service/mobile/chat/PagesPicaMobileChat";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { PicaMobileChatServices } from "@/backend/service/mobile/chat/PagesPicaMobileChat";
import type { PicaMobileChatContext } from "@/backend/service/mobile/chat/PicaMobileChatProvider";

const context = partial<PicaMobileChatContext>({
  session: partial({ userId: "u", sessionToken: "token" }),
  origin: "https://pages.test",
});

function fixture(): {
  provider: PagesPicaMobileChat;
  services: PicaMobileChatServices;
  auth: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  const auth = vi
    .fn()
    .mockResolvedValue({ id: "u", isActive: true, mustChangePassword: false });
  const submit = vi.fn();
  const remove = vi.fn();
  const services = partial<PicaMobileChatServices>({
    authService: { getAuthenticatedUser: auth },
    chatSessionService: partial({
      require: vi.fn().mockResolvedValue(undefined),
      removeSelected: remove,
    }),
    chatService: { submit },
    picaAcpService: null,
    chatAttachmentService: partial({
      discard: vi.fn().mockResolvedValue(undefined),
    }),
    picaAdminService: { protectOrigin: vi.fn() },
  });
  return {
    provider: new PagesPicaMobileChat(async () => services),
    services,
    auth,
    submit,
    remove,
  };
}

describe("mobile chat provider", () => {
  it("rejects expired sessions and protects origins when sending", async () => {
    const { provider, services, auth, submit } = fixture();
    const request = {
      type: "chat_send" as const,
      payload: {
        sessionId: "s",
        clientMessageId: "id",
        text: "hello",
        attachmentIds: [],
      },
    };
    auth.mockResolvedValueOnce(null);
    await expect(provider.answer(context, request)).resolves.toEqual({
      kind: "sessionEnded",
    });
    submit
      .mockResolvedValueOnce({
        kind: "job",
        job: { messageId: "m", job: { id: "j" } },
      })
      .mockResolvedValueOnce({
        kind: "steer",
        steer: { messageId: "m", jobId: "j", status: "queued" },
      })
      .mockResolvedValueOnce({ kind: "reply" });
    await expect(provider.answer(context, request)).resolves.toMatchObject({
      answer: { type: "chat_sent", payload: { kind: "job", jobId: "j" } },
    });
    await expect(provider.answer(context, request)).resolves.toMatchObject({
      answer: { type: "chat_sent", payload: { kind: "steer" } },
    });
    await expect(provider.answer(context, request)).resolves.toEqual({
      kind: "unavailable",
    });
    expect(services.picaAdminService.protectOrigin).toHaveBeenCalledWith(
      "https://pages.test",
    );
  });

  it("maps deletion outcomes and chat errors", async () => {
    const { provider, remove, submit } = fixture();
    const request = {
      type: "chat_delete" as const,
      payload: { sessionId: "s" },
    };
    remove
      .mockResolvedValueOnce({
        deleted: [],
        failed: [{ sessionId: "s", error: "sessionMissing" }],
      })
      .mockResolvedValueOnce({ deleted: [], failed: [] })
      .mockResolvedValueOnce({ deleted: ["s"], failed: [] });
    await expect(provider.answer(context, request)).resolves.toMatchObject({
      answer: { type: "chat_failed", payload: { code: "sessionMissing" } },
    });
    await expect(provider.answer(context, request)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(provider.answer(context, request)).resolves.toMatchObject({
      answer: { type: "chat_deleted" },
    });
    submit.mockRejectedValueOnce(new ChatError("disabled"));
    await expect(
      provider.answer(context, {
        type: "chat_send",
        payload: {
          sessionId: "s",
          clientMessageId: "id",
          text: "hello",
          attachmentIds: [],
        },
      }),
    ).resolves.toMatchObject({
      answer: { type: "chat_failed", payload: { code: "disabled" } },
    });
  });

  it("checks session access when stopping without an ACP service", async () => {
    const { provider, services } = fixture();
    await expect(
      provider.answer(context, {
        type: "chat_stop",
        payload: { sessionId: "s" },
      }),
    ).resolves.toMatchObject({
      answer: { type: "chat_stopped", payload: { sessionId: "s" } },
    });
    expect(services.chatSessionService.require).toHaveBeenCalledOnce();
    await expect(provider.discard(context.session, "a")).resolves.toEqual({
      kind: "discarded",
    });
  });
});
