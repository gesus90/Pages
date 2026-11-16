import { expect, it, vi } from "vitest";

import { SpeechProviderClient } from "@/backend/service/speech/SpeechProviderClient";

import type { SpeechProviderRequest } from "@/backend/service/speech/SpeechProviderClient";

const request: SpeechProviderRequest = {
  provider: "openrouter",
  apiKey: "secret-key",
  model: "model",
  audio: Buffer.from("audio"),
  mimeType: "audio/wav",
  signal: new AbortController().signal,
};

it("sends audio to the selected provider and strips any echoed key", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ text: "  Hello secret-key world  " }), {
        status: 200,
      }),
  );
  const client = new SpeechProviderClient(fetcher);
  expect(await client.transcribe(request)).toEqual({
    ok: true,
    text: "Hello  world",
  });
  expect(fetcher).toHaveBeenCalledWith(
    expect.stringContaining("/audio/transcriptions"),
    expect.objectContaining({
      method: "POST",
      redirect: "error",
    }),
  );
  const options = fetcher.mock.calls[0][1];
  expect(new Headers(options?.headers).get("Authorization")).toBe(
    "Bearer secret-key",
  );
  expect(JSON.parse(String(options?.body))).toMatchObject({
    model: "model",
    input_audio: {
      format: "wav",
      data: Buffer.from("audio").toString("base64"),
    },
  });
});

it("uses multipart form data for ZAI", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response('{"text":"recognized"}'),
  );
  const client = new SpeechProviderClient(fetcher);
  expect(
    await client.transcribe({
      ...request,
      provider: "zai",
      mimeType: "audio/mpeg",
    }),
  ).toEqual({ ok: true, text: "recognized" });
  const body = fetcher.mock.calls[0][1]?.body;
  expect(body).toBeInstanceOf(FormData);
  if (!(body instanceof FormData)) throw new Error("Expected form data");
  expect(body.get("model")).toBe("model");
  expect(body.get("file")).toBeInstanceOf(Blob);
});

it.each([
  new Response("invalid", { status: 200 }),
  new Response('{"other":"value"}', { status: 200 }),
  new Response('{"text":"ignored"}', { status: 500 }),
  new Response("x".repeat(1024 * 1024 + 1), { status: 200 }),
])("reports failed or malformed provider responses", async (response) => {
  const client = new SpeechProviderClient(
    vi.fn<typeof fetch>(async () => response),
  );
  expect(await client.transcribe(request)).toEqual({
    ok: false,
    code: "provider_failed",
  });
});

it("distinguishes unreachable providers from caller cancellation", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error("offline");
  });
  const client = new SpeechProviderClient(fetcher);
  expect(await client.transcribe(request)).toEqual({
    ok: false,
    code: "provider_unreachable",
  });
  const controller = new AbortController();
  controller.abort();
  await expect(
    client.transcribe({ ...request, signal: controller.signal }),
  ).rejects.toThrow();
});
