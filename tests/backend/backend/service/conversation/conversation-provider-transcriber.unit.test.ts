import { Readable } from "node:stream";

import { afterEach, expect, it, vi } from "vitest";

import { ConversationProviderTranscriber } from "@/backend/service/conversation/ConversationProviderTranscriber";
import { logEvent } from "@/backend/logging/Logger";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(" secret-key\n"),
}));
vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

const input = {
  open: () => Readable.from([Buffer.from("audio")]),
  mimeType: "audio/mpeg",
  sizeBytes: 5,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("sends the audio and trimmed authorization key to the configured model", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ text: " Hello " }));
  vi.stubGlobal("fetch", fetchMock);
  const transcriber = new ConversationProviderTranscriber({
    model: "speech",
    url: "https://example.invalid/transcribe",
    apiKeyFile: "/key",
  });
  await expect(transcriber.transcribe(input)).resolves.toEqual({
    ok: true,
    text: " Hello ",
  });
  const [url, options] = fetchMock.mock.calls[0] ?? [];
  if (
    !(options?.headers instanceof Headers) ||
    !(options.body instanceof FormData)
  ) {
    throw new Error("Expected multipart request with headers");
  }
  expect(url).toBe("https://example.invalid/transcribe");
  expect(options.method).toBe("POST");
  expect(options.headers.get("Authorization")).toBe("Bearer secret-key");
  expect(options.body.get("model")).toBe("speech");
  const file = options.body.get("file");
  if (!(file instanceof File)) throw new Error("Expected an audio file");
  expect(file.name).toBe("voice.mp3");
  expect(file.type).toBe("audio/mpeg");
  expect(await file.text()).toBe("audio");
});

it("uses a wav filename without authorization and rejects empty or malformed transcripts", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ text: "  " }))
    .mockResolvedValueOnce(Response.json({ text: 3 }));
  vi.stubGlobal("fetch", fetchMock);
  const transcriber = new ConversationProviderTranscriber({
    model: "speech",
    url: "https://example.invalid",
    apiKeyFile: null,
  });
  const wav = { ...input, mimeType: "audio/wav" };
  await expect(transcriber.transcribe(wav)).resolves.toEqual({ ok: false });
  await expect(transcriber.transcribe(wav)).resolves.toEqual({ ok: false });
  const options = fetchMock.mock.calls[0]?.[1];
  if (
    !(options?.headers instanceof Headers) ||
    !(options.body instanceof FormData)
  ) {
    throw new Error("Expected multipart request with headers");
  }
  expect(options.headers.has("Authorization")).toBe(false);
  const file = options.body.get("file");
  if (!(file instanceof File)) throw new Error("Expected an audio file");
  expect(file.name).toBe("voice.wav");
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ metadata: { reason: "empty", model: "speech" } }),
  );
});

it("reports refusals and request failures without throwing", async () => {
  const failure = new Error("network failed");
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockRejectedValueOnce(failure);
  vi.stubGlobal("fetch", fetchMock);
  const transcriber = new ConversationProviderTranscriber({
    model: "speech",
    url: "https://example.invalid",
    apiKeyFile: null,
  });
  await expect(transcriber.transcribe(input)).resolves.toEqual({ ok: false });
  await expect(transcriber.transcribe(input)).resolves.toEqual({ ok: false });
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: { reason: "refused", model: "speech", status: 429 },
    }),
  );
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: { reason: "request_failed", model: "speech" },
      error: failure,
    }),
  );
});
