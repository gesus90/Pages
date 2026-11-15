import { describe, expect, it, vi } from "vitest";

import {
  GoogleMediaClient,
  OpenRouterMediaClient,
} from "@/backend/agents/providers/ProviderMediaClients";
import { pcmToWav } from "@/backend/agents/providers/ProviderMediaTransport";

const KEY = "sk-or-secret-key-123";
const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);

describe("the OpenRouter media interface (PAGE-384)", () => {
  it("streams OpenRouter audio as PCM and stores it as WAV with the cost", async () => {
    const pcm = Buffer.from([1, 0, 2, 0, 3, 0]);
    const stream = [
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: pcm.subarray(0, 4).toString("base64"), transcript: "Hal" } } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: pcm.subarray(4).toString("base64"), transcript: "lo" } } }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { cost: 0.003 } })}`,
      "data: [DONE]",
    ].join("\n\n");
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(stream, { status: 200 }));
    const answer = await new OpenRouterMediaClient(transport).generate({
      apiKey: KEY,
      model: "openai/gpt-audio",
      kind: "audio",
      prompt: "Hallo",
      signal: new AbortController().signal,
    });
    expect(answer.media[0]?.mimeType).toBe("audio/wav");
    expect(answer.media[0]?.bytes).toEqual(pcmToWav(pcm, 24_000));
    expect(answer.text).toBe("Hallo");
    expect(answer.costUsd).toBe(0.003);
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${KEY}`,
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      modalities: ["text", "audio"],
      audio: { format: "pcm16" },
      stream: true,
    });
    await expect(
      new OpenRouterMediaClient(transport).generate({
        apiKey: KEY,
        model: "x",
        kind: "video",
        prompt: "x",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "no_media_interface" });
  });
});

describe("the Google Gemini audio interface (PAGE-384)", () => {
  it("puts Gemini speech PCM into a WAV file at its rate", async () => {
    const pcm = Buffer.from([5, 0, 6, 0]);
    const transport = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/L16;codec=pcm;rate=16000",
                    data: pcm.toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    const answer = await new GoogleMediaClient(transport).generate({
      apiKey: KEY,
      model: "gemini-tts",
      kind: "audio",
      prompt: "Hallo",
      signal: new AbortController().signal,
    });
    expect(answer.media[0]?.bytes).toEqual(pcmToWav(pcm, 16_000));
    const body = JSON.parse(
      String((transport.mock.calls[0] as [string, RequestInit])[1].body),
    ) as {
      generationConfig: { responseModalities: string[] };
    };
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
  });
});

describe("the Google Veo video interface (PAGE-384)", () => {
  it("starts a Veo operation, waits for it and loads the video without sending the key to the storage", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers = [
      Response.json({ name: "models/veo/operations/op-1" }),
      Response.json({ name: "models/veo/operations/op-1", done: false }),
      Response.json({
        name: "models/veo/operations/op-1",
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [
              {
                video: {
                  uri: "https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media",
                },
              },
            ],
          },
        },
      }),
      new Response(null, {
        status: 302,
        headers: { location: "https://storage.example/video.mp4" },
      }),
      new Response(MP4, {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }),
    ];
    const transport = vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        answers.shift() ?? new Response(null, { status: 500 }),
      );
    });
    const answer = await new GoogleMediaClient(
      transport as unknown as typeof fetch,
      1,
    ).generate({
      apiKey: KEY,
      model: "veo",
      kind: "video",
      prompt: "Fuchs",
      aspectRatio: "16:9",
      durationSeconds: 8,
      signal: new AbortController().signal,
    });
    expect(answer.media[0]).toEqual({ mimeType: "video/mp4", bytes: MP4 });
    expect(calls[0]?.url).toContain("models/veo:predictLongRunning");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      instances: [{ prompt: "Fuchs" }],
      parameters: { aspectRatio: "16:9", durationSeconds: 8 },
    });
    expect(calls[1]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/veo/operations/op-1",
    );
    expect(calls[4]?.url).toBe("https://storage.example/video.mp4");
    expect(JSON.stringify(calls[4]?.init.headers ?? {})).not.toContain(KEY);
  });

  it("refuses a download address outside the Gemini API", async () => {
    const transport = vi.fn().mockResolvedValueOnce(
      Response.json({
        name: "op",
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [{ video: { uri: "https://evil.example/x" } }],
          },
        },
      }),
    );
    await expect(
      new GoogleMediaClient(transport, 1).generate({
        apiKey: KEY,
        model: "veo",
        kind: "video",
        prompt: "x",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "provider_failed" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
