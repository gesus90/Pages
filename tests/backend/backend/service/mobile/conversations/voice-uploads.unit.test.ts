import { afterEach, expect, it, vi } from "vitest";

import { PicaMobileVoiceUploads } from "@/backend/service/mobile/conversations/PicaMobileVoiceUploads";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { PicaMobileVoiceMessage } from "@/backend/service/mobile/conversations/PicaMobileVoiceUploads";
import type { PicaMobileConversationsProvider } from "@/backend/service/mobile/conversations/PicaMobileConversationsProvider";
import type { PicaMobileSessionIdentity } from "@/backend/service/mobile/PicaMobileDashboardProvider";
import type { PicaMobilePlansHost } from "@/backend/service/mobile/plans/PicaMobilePlansHandler";

const SESSION = partial<PicaMobileSessionIdentity>({
  userId: "user",
  sessionToken: "token",
});

it("accepts ordered chunks and finishes the stored voice message", async () => {
  const write = vi.fn();
  const finish = vi.fn(async () => ({
    kind: "ok",
    answer: { type: "voice_saved", payload: {} },
  }));
  const acknowledge = vi.fn();
  const send = vi.fn();
  const provider = partial<PicaMobileConversationsProvider>({
    beginVoice: async () => ({
      kind: "ok",
      sink: { write, finish, cancel: () => {} },
    }),
  });
  const host = partial<PicaMobilePlansHost>({
    isOpen: () => true,
    acknowledge,
    send,
  });
  const uploads = new PicaMobileVoiceUploads(provider, host, "connection");
  await uploads.handle(
    partial<PicaMobileVoiceMessage>({
      type: "voice_start",
      requestId: "start",
      payload: { id: "voice" },
    }),
    SESSION,
  );
  await uploads.handle(
    partial<PicaMobileVoiceMessage>({
      type: "voice_chunk",
      requestId: "chunk",
      payload: {
        id: "voice",
        index: 0,
        data: Buffer.from("audio").toString("base64"),
      },
    }),
    SESSION,
  );
  await uploads.handle(
    partial<PicaMobileVoiceMessage>({
      type: "voice_finish",
      requestId: "finish",
      payload: { id: "voice", chunkCount: 1 },
    }),
    SESSION,
  );
  expect(write).toHaveBeenCalledWith(Buffer.from("audio"));
  expect(finish).toHaveBeenCalledOnce();
  expect(acknowledge).toHaveBeenCalledTimes(3);
  expect(send).toHaveBeenCalledOnce();
});

afterEach(() => {
  vi.useRealTimers();
});

it("cancels an out-of-order upload and reports the refusal once", async () => {
  const cancel = vi.fn();
  const send = vi.fn();
  const provider = partial<PicaMobileConversationsProvider>({
    beginVoice: async () => ({ kind: "ok", sink: { cancel } }),
  });
  const host = partial<PicaMobilePlansHost>({
    isOpen: () => true,
    acknowledge: () => {},
    send,
  });
  const uploads = new PicaMobileVoiceUploads(provider, host, "connection");
  await uploads.handle(
    partial<PicaMobileVoiceMessage>({
      type: "voice_start",
      requestId: "start",
      payload: { id: "voice" },
    }),
    SESSION,
  );
  const chunk = partial<PicaMobileVoiceMessage>({
    type: "voice_chunk",
    requestId: "chunk",
    payload: { id: "voice", index: 1, data: "" },
  });
  await uploads.handle(chunk, SESSION);
  await uploads.handle(chunk, SESSION);
  expect(cancel).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledTimes(1);
});

it("expires an idle upload and repeats its failure when finishing", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const send = vi.fn();
  const provider = partial<PicaMobileConversationsProvider>({
    beginVoice: async () => ({ kind: "ok", sink: { cancel } }),
  });
  const host = partial<PicaMobilePlansHost>({
    isOpen: () => true,
    acknowledge: () => {},
    send,
  });
  const uploads = new PicaMobileVoiceUploads(provider, host, "connection");
  await uploads.handle(
    partial<PicaMobileVoiceMessage>({
      type: "voice_start",
      requestId: "start",
      payload: { id: "voice" },
    }),
    SESSION,
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(cancel).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledTimes(1);
  await uploads.handle(
    partial<PicaMobileVoiceMessage>({
      type: "voice_finish",
      requestId: "finish",
      payload: { id: "voice", chunkCount: 0 },
    }),
    SESSION,
  );
  expect(send).toHaveBeenCalledTimes(2);
});
