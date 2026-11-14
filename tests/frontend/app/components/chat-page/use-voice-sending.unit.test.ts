import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useVoiceSending } from "@/app/components/chat-page/use-voice-sending";
import { CONVERSATION_VOICE_MAXIMUM_BYTES } from "@/definition/Conversation";

import type * as VoiceAudio from "@/app/components/chat-page/voice-audio";

const revalidate = vi.hoisted(() => vi.fn());
const decodeAudio = vi.hoisted(() => vi.fn());
vi.mock("react-router", () => ({ useRevalidator: () => ({ revalidate }) }));
vi.mock("@/app/components/chat-page/voice-audio", async (original) => ({
  ...(await original<typeof VoiceAudio>()),
  decodeAudio,
}));

const selection = { kind: "group", id: "team" } as const;

beforeEach(() => {
  revalidate.mockReset();
  decodeAudio.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

it("sends a recording with its rounded duration and refreshes the conversation", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
  const { result } = renderHook(() => useVoiceSending(selection, 5000));
  const file = new Blob(["audio"], { type: "audio/wav" });
  act(() => result.current.sendRecording({ file, durationMs: 1234.6 }));
  await waitFor(() => expect(result.current.isSending).toBe(false));
  expect(fetch).toHaveBeenCalledOnce();
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(String(url)).toContain("kind=group&id=team");
  expect(String(url)).toContain("durationMs=1235");
  expect(options).toMatchObject({
    method: "POST",
    body: file,
    headers: { "Content-Type": "audio/wav" },
  });
  expect(revalidate).toHaveBeenCalledOnce();
  expect(result.current.failure).toBeNull();
});

it("reports server refusals and microphone errors", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
  );
  const { result } = renderHook(() => useVoiceSending(selection, 5000));
  act(() => result.current.sendRecording({ file: new Blob(), durationMs: 0 }));
  await waitFor(() => expect(result.current.failure).toBe("forbidden"));
  expect(revalidate).toHaveBeenCalledOnce();
  act(() => result.current.reportMicrophone());
  expect(result.current.failure).toBe("microphone");
});

it("rejects unsupported and oversized files before decoding", () => {
  const { result } = renderHook(() => useVoiceSending(selection, 5000));
  act(() =>
    result.current.sendFile(new File(["x"], "x.txt", { type: "text/plain" })),
  );
  expect(result.current.failure).toBe("unsupported_format");
  const file = new File([], "x.wav", { type: "audio/wav" });
  Object.defineProperty(file, "size", {
    value: CONVERSATION_VOICE_MAXIMUM_BYTES + 1,
  });
  act(() => result.current.sendFile(file));
  expect(result.current.failure).toBe("too_large");
  expect(decodeAudio).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("does not send a recording without a conversation", () => {
  const { result } = renderHook(() => useVoiceSending(null, 5000));
  act(() => result.current.sendRecording({ file: new Blob(), durationMs: 1 }));
  expect(fetch).not.toHaveBeenCalled();
  expect(result.current.isSending).toBe(false);
});
