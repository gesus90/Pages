import { expect, it, vi } from "vitest";

import { PicaMobileChatHandler } from "@/backend/service/mobile/chat/PicaMobileChatHandler";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PicaMobileChatProvider } from "@/backend/service/mobile/chat/PicaMobileChatProvider";
import type { PicaMobileChatClientMessage } from "@/backend/service/mobile/PicaMobileMessages";
import type { PicaMobileNotificationHost } from "@/backend/service/mobile/notifications/PicaMobileNotificationHandler";

const message = partial<PicaMobileChatClientMessage>({
  type: "chat_get",
  requestId: "request",
});

function host(): PicaMobileNotificationHost {
  return {
    isOpen: vi.fn(() => true),
    session: vi.fn(() => partial({ userId: "user" })),
    send: vi.fn(() => true),
    reject: vi.fn(),
    rejectUnauthenticated: vi.fn(),
    acknowledge: vi.fn(),
    endSession: vi.fn(),
    reportFailure: vi.fn(),
  };
}

it("rejects missing providers, unsupported deletion, and unauthenticated requests", async () => {
  const connection = host();
  await new PicaMobileChatHandler(undefined, connection, null).handle(message);
  expect(connection.reject).toHaveBeenCalledOnce();
  const provider = partial<PicaMobileChatProvider>({
    canDelete: false,
    answer: vi.fn(),
  });
  await new PicaMobileChatHandler(provider, connection, null).handle(
    partial({ type: "chat_delete", requestId: "delete" }),
  );
  expect(connection.reject).toHaveBeenCalledTimes(2);
  vi.mocked(connection.session).mockReturnValue(null);
  await new PicaMobileChatHandler(provider, connection, null).handle(message);
  expect(connection.rejectUnauthenticated).toHaveBeenCalledWith("request");
  expect(provider.answer).not.toHaveBeenCalled();
});

it("acknowledges answers and ends a revoked session", async () => {
  const connection = host();
  const answer = vi
    .fn<PicaMobileChatProvider["answer"]>()
    .mockResolvedValueOnce(
      partial({
        kind: "answer",
        answer: { type: "chat", payload: { text: "hello" } },
      }),
    )
    .mockResolvedValueOnce({ kind: "sessionEnded" });
  const handler = new PicaMobileChatHandler(
    partial({ canDelete: true, answer }),
    connection,
    "https://pages.example",
  );
  await handler.handle(message);
  expect(answer).toHaveBeenCalledWith(
    expect.objectContaining({ origin: "https://pages.example" }),
    message,
  );
  expect(connection.acknowledge).toHaveBeenCalledOnce();
  expect(connection.send).toHaveBeenCalledWith(
    expect.stringContaining("hello"),
  );
  await handler.handle(message);
  expect(connection.endSession).toHaveBeenCalledWith("request");
});

it("does not answer a closed connection and rejects unavailable results", async () => {
  const connection = host();
  const answer = vi
    .fn<PicaMobileChatProvider["answer"]>()
    .mockResolvedValue(partial({ kind: "unavailable" }));
  const handler = new PicaMobileChatHandler(
    partial({ answer }),
    connection,
    null,
  );
  vi.mocked(connection.isOpen).mockReturnValueOnce(false);
  await handler.handle(message);
  expect(answer).not.toHaveBeenCalled();
  await handler.handle(message);
  expect(connection.reject).toHaveBeenCalledOnce();
  expect(connection.send).not.toHaveBeenCalled();
});
