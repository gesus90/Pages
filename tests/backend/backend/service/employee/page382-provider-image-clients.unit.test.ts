import { describe, expect, it, vi } from "vitest";

import {
  GoogleImageClient,
  OpenRouterImageClient,
} from "@/backend/agents/providers/ProviderImageClients";
import { AgentImageError } from "@/backend/error/AgentImageError";

const KEY = "sk-or-secret-key-123";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("the OpenRouter image interface (PAGE-382)", () => {
  it("asks OpenRouter for image output with the key in the header and reads the data URLs and the cost", async () => {
    const transport = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: "Hier ist dein Bild.",
              images: [
                {
                  image_url: {
                    url: `data:image/png;base64,${PNG.toString("base64")}`,
                  },
                },
              ],
            },
          },
        ],
        usage: { cost: 0.039 },
      }),
    );
    const answer = await new OpenRouterImageClient(transport).generate({
      apiKey: KEY,
      model: "google/gemini-2.5-flash-image",
      prompt: "Fuchs",
      aspectRatio: "16:9",
      templates: [{ mimeType: "image/png", bytes: PNG }],
      signal: new AbortController().signal,
    });
    expect(answer).toEqual({
      images: [{ mimeType: "image/png", bytes: PNG }],
      text: "Hier ist dein Bild.",
      costUsd: 0.039,
    });
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    expect(init.redirect).toBe("error");
    const body: unknown = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "google/gemini-2.5-flash-image",
      modalities: ["image", "text"],
      image_config: { aspect_ratio: "16:9" },
    });
    expect(String(init.body)).not.toContain(KEY);
  });

  it("turns a refusal of OpenRouter into a readable failure", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { message: "Insufficient credits" } },
          { status: 402 },
        ),
      );
    await expect(
      new OpenRouterImageClient(transport).generate({
        apiKey: KEY,
        model: "m",
        prompt: "x",
        templates: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toEqual(
      new AgentImageError("provider_failed", "Insufficient credits"),
    );
  });

  it("reports an unreachable provider", async () => {
    const transport = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      new OpenRouterImageClient(transport).generate({
        apiKey: KEY,
        model: "m",
        prompt: "x",
        templates: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "provider_unreachable" });
  });
});

describe("the Google image interface (PAGE-382)", () => {
  it("asks Gemini for text and image output and reads the inline images", async () => {
    const transport = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                { text: "Bitte schön." },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: PNG.toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    const answer = await new GoogleImageClient(transport).generate({
      apiKey: KEY,
      model: "gemini-2.5-flash-image",
      prompt: "Fuchs",
      aspectRatio: "1:1",
      templates: [],
      signal: new AbortController().signal,
    });
    expect(answer).toEqual({
      images: [{ mimeType: "image/png", bytes: PNG }],
      text: "Bitte schön.",
      costUsd: null,
    });
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    );
    expect(init.headers).toMatchObject({ "x-goog-api-key": KEY });
    expect(JSON.parse(String(init.body))).toMatchObject({
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "1:1" },
      },
    });
  });
});
