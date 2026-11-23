import { describe, expect, it, vi } from "vitest";

import {
  GoogleImageClient,
  OpenRouterImageClient,
} from "@/backend/agents/providers/ProviderImageClients";
import { AgentImageError } from "@/backend/error/AgentImageError";

import type {
  ProviderImage,
  ProviderImageRequest,
} from "@/backend/agents/providers/ProviderImageClients";
import type * as ImageModule from "@/definition/AgentImageGeneration";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

vi.mock("@/definition/AgentImageGeneration", async (importOriginal) => {
  const original = await importOriginal<typeof ImageModule>();
  return {
    ...original,
    AGENT_IMAGE_LIMITS: { ...original.AGENT_IMAGE_LIMITS, answerBytes: 1000 },
  };
});

const PNG: ProviderImage = { mimeType: "image/png", bytes: Buffer.from("png") };
const PNG_URL = `data:image/png;base64,${Buffer.from("out").toString("base64")}`;

function request(
  overrides: Partial<ProviderImageRequest> = {},
): ProviderImageRequest {
  return {
    apiKey: "key-1",
    model: "m/x y",
    prompt: "a cat",
    templates: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function transportFor(response: Response | Error): typeof fetch {
  return vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response),
  );
}

async function failureOf(promise: Promise<unknown>): Promise<AgentImageError> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof AgentImageError)) throw new Error("no image error");
  return error;
}

function sentBody(transport: typeof fetch): unknown {
  const calls = vi.mocked(transport).mock.calls;
  const init = calls[0]?.[1];
  return JSON.parse(String(init?.body));
}

describe("OpenRouterImageClient", () => {
  it("sends templates and ratio and reads images, text and cost", async () => {
    const transport = transportFor(
      json({
        choices: [
          {
            message: {
              content: " done ",
              images: [
                { image_url: { url: PNG_URL } },
                { image_url: { url: "data:image/svg+xml;base64,AAAA" } },
                { image_url: { url: "https://x.test/a.png" } },
              ],
            },
          },
        ],
        usage: { cost: 0.5 },
      }),
    );
    const answer = await new OpenRouterImageClient(transport).generate(
      request({ templates: [PNG], aspectRatio: "16:9" }),
    );
    expect(answer).toEqual({
      images: [{ mimeType: "image/png", bytes: Buffer.from("out") }],
      text: "done",
      costUsd: 0.5,
    });
    expect(sentBody(transport)).toMatchObject({
      image_config: { aspect_ratio: "16:9" },
      messages: [{ content: [{ text: "a cat" }, { type: "image_url" }] }],
    });
  });

  it("copes with a bare message without ratio", async () => {
    const transport = transportFor(json({ choices: [{ message: {} }] }));
    const answer = await new OpenRouterImageClient(transport).generate(
      request(),
    );
    expect(answer).toEqual({ images: [], text: "", costUsd: null });
    expect(sentBody(transport)).not.toHaveProperty("image_config");
  });

  it("uses the global fetch by default", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json({ choices: [{ message: {} }] }));
    await new OpenRouterImageClient().generate(request());
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("refuses an answer of the wrong shape", async () => {
    const error = await failureOf(
      new OpenRouterImageClient(transportFor(json({ choices: [] }))).generate(
        request(),
      ),
    );
    expect(error.detail).toBe("Antwort unlesbar");
  });
});

describe("GoogleImageClient", () => {
  it("sends templates and ratio and reads images and text", async () => {
    const transport = transportFor(
      json({
        candidates: [
          {
            content: {
              parts: [
                { text: "hello" },
                { inlineData: { mimeType: "image/png", data: "b3V0" } },
                { inlineData: { mimeType: "image/bmp", data: "b3V0" } },
                {},
                { text: "world" },
              ],
            },
          },
        ],
      }),
    );
    const answer = await new GoogleImageClient(transport).generate(
      request({ templates: [PNG], aspectRatio: "1:1" }),
    );
    expect(answer).toEqual({
      images: [{ mimeType: "image/png", bytes: Buffer.from("out") }],
      text: "hello    world",
      costUsd: null,
    });
    expect(vi.mocked(transport).mock.calls[0]?.[0]).toContain("m%2Fx%20y");
    expect(sentBody(transport)).toMatchObject({
      generationConfig: { imageConfig: { aspectRatio: "1:1" } },
    });
  });

  it("copes with missing candidates and no ratio", async () => {
    for (const body of [{}, { candidates: [{}] }]) {
      const transport = transportFor(json(body));
      const answer = await new GoogleImageClient(transport).generate(request());
      expect(answer).toEqual({ images: [], text: "", costUsd: null });
    }
  });

  it("uses the global fetch by default", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({}));
    await new GoogleImageClient().generate(request());
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("refuses an answer of the wrong shape", async () => {
    const error = await failureOf(
      new GoogleImageClient(transportFor(json({ candidates: 3 }))).generate(
        request(),
      ),
    );
    expect(error.detail).toBe("Antwort unlesbar");
  });
});

describe("shared request handling", () => {
  const client = (response: Response | Error): OpenRouterImageClient =>
    new OpenRouterImageClient(transportFor(response));

  it("reports the message of an error answer", async () => {
    const error = await failureOf(
      client(json({ error: { message: " busy " } }, 429)).generate(request()),
    );
    expect([error.code, error.detail]).toEqual(["provider_failed", "busy"]);
  });

  it("keeps the status for an error without a usable body", async () => {
    for (const body of ["nope", '{"error":1}']) {
      const error = await failureOf(
        client(new Response(body, { status: 502 })).generate(request()),
      );
      expect(error.detail).toBe("HTTP 502");
    }
  });

  it("maps a failed transport to unreachable", async () => {
    const error = await failureOf(
      client(new Error("down")).generate(request()),
    );
    expect([error.code, error.detail]).toEqual(["provider_unreachable", ""]);
  });

  it("names the timeout of an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const timedOut = await failureOf(
      client(new Error("aborted")).generate(
        request({ signal: controller.signal }),
      ),
    );
    expect(timedOut.detail).toBe("Zeit abgelaufen");
    const own = await failureOf(
      client(new AgentImageError("no_key")).generate(
        request({ signal: controller.signal }),
      ),
    );
    expect(own.detail).toBe("");
  });

  it("refuses a too large stated length, with or without a body", async () => {
    const headers = { "content-length": "1001" };
    for (const response of [
      new Response("{}", { headers }),
      new Response(null, { headers }),
    ]) {
      const error = await failureOf(client(response).generate(request()));
      expect(error.detail).toBe("Antwort zu groß");
    }
  });

  it("refuses a too large and an unreadable body", async () => {
    const large = await failureOf(
      client(new Response("x".repeat(1001))).generate(request()),
    );
    expect(large.detail).toBe("Antwort zu groß");
    const broken = await failureOf(
      client(new Response("nope")).generate(request()),
    );
    expect(broken.detail).toBe("Antwort ist kein JSON");
  });
});
