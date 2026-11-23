import { describe, expect, it, vi } from "vitest";

import {
  GoogleMediaClient,
  OpenRouterMediaClient,
} from "@/backend/agents/providers/ProviderMediaClients";
import { AgentMediaError } from "@/backend/error/AgentMediaError";

import type { ProviderMediaRequest } from "@/backend/agents/providers/ProviderMediaClients";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

const GOOGLE = "https://generativelanguage.googleapis.com/v1beta";

function request(
  overrides: Partial<ProviderMediaRequest> = {},
): ProviderMediaRequest {
  return {
    apiKey: "key-1",
    model: "m/x",
    kind: "audio",
    prompt: "hello",
    signal: new AbortController().signal,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Answers the calls one after the other with the given responses. */
function scripted(...responses: (Response | Error)[]): typeof fetch {
  const queue = [...responses];
  return vi.fn(() => {
    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error("unexpected"));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
}

async function failureOf(promise: Promise<unknown>): Promise<AgentMediaError> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof AgentMediaError)) throw new Error("no media error");
  return error;
}

function sentBody(transport: typeof fetch, call = 0): unknown {
  const init = vi.mocked(transport).mock.calls[call]?.[1];
  return JSON.parse(String(init?.body));
}

function stream(...lines: string[]): Response {
  return new Response(lines.join("\n"));
}

function delta(value: unknown): string {
  return `data: ${JSON.stringify({ choices: [{ delta: value }] })}`;
}

function doneOperation(uri?: string): Response {
  return json({
    name: "operations/1",
    done: true,
    response: {
      generateVideoResponse: {
        generatedSamples: uri === undefined ? [] : [{ video: { uri } }],
        raiMediaFilteredReasons: ["blocked", "unsafe"],
      },
    },
  });
}

function videoFile(type?: string): Response {
  return type
    ? new Response("mp4", { headers: { "content-type": type } })
    : new Response(new Uint8Array([109, 112, 52]));
}

describe("OpenRouterMediaClient", () => {
  it("offers audio alone and refuses a video", async () => {
    const client = new OpenRouterMediaClient(scripted());
    expect(client.kinds).toEqual(["audio"]);
    const error = await failureOf(client.generate(request({ kind: "video" })));
    expect(error.code).toBe("no_media_interface");
  });

  it("collects audio, text and cost from the stream", async () => {
    const pcm = Buffer.from([1, 0, 2, 0]);
    const transport = scripted(
      stream(
        "event: ping",
        "data:",
        delta({ audio: { data: pcm.toString("base64"), transcript: "Hi " } }),
        delta({ audio: { data: "" } }),
        delta({ content: "there" }),
        delta({ content: null }),
        delta({}),
        "data: not json",
        'data: {"choices":"bad"}',
        `data: ${JSON.stringify({ usage: { cost: 0.25 } })}`,
        "data: [DONE]",
      ),
    );
    const answer = await new OpenRouterMediaClient(transport).generate(
      request({ voice: "echo" }),
    );
    expect(answer.text).toBe("Hi there");
    expect(answer.costUsd).toBe(0.25);
    expect(answer.media).toHaveLength(1);
    expect(answer.media[0]?.mimeType).toBe("audio/wav");
    expect(answer.media[0]?.bytes.subarray(44)).toEqual(pcm);
    expect(sentBody(transport)).toMatchObject({ audio: { voice: "echo" } });
  });

  it("uses the default voice and returns no file without audio", async () => {
    const transport = scripted(stream('data: {"choices":[{}]}'));
    const answer = await new OpenRouterMediaClient(transport).generate(
      request(),
    );
    expect(answer).toEqual({ media: [], text: "", costUsd: null });
    expect(sentBody(transport)).toMatchObject({ audio: { voice: "alloy" } });
  });

  it("uses the global fetch by default", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(""));
    await new OpenRouterMediaClient().generate(request());
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("GoogleMediaClient audio", () => {
  const part = (mimeType: string, payload = "AQID"): unknown => ({
    inlineData: { mimeType, data: payload },
  });
  const answerOf = (...parts: unknown[]): Response =>
    json({ candidates: [{ content: { parts } }] });

  it("offers video and audio", () => {
    expect(new GoogleMediaClient(scripted()).kinds).toEqual(["video", "audio"]);
  });

  it("converts raw PCM and keeps known containers", async () => {
    const transport = scripted(
      answerOf(
        { text: "spoken" },
        part("audio/L16;codec=pcm;rate=16000"),
        part("audio/x-wav"),
        part("Audio/MPEG; charset=x"),
        part("audio/unknown"),
        part(""),
      ),
    );
    const answer = await new GoogleMediaClient(transport).generate(
      request({ voice: "Puck" }),
    );
    expect(answer.media.map((media) => media.mimeType)).toEqual([
      "audio/wav",
      "audio/wav",
      "audio/mpeg",
    ]);
    expect(answer.media[0]?.bytes.readUInt32LE(24)).toBe(16_000);
    expect(answer.text).toBe("spoken");
    expect(sentBody(transport)).toMatchObject({
      generationConfig: {
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
        },
      },
    });
  });

  it("copes with missing candidates and uses the default voice", async () => {
    for (const body of [{}, { candidates: [{}] }]) {
      const transport = scripted(json(body));
      const answer = await new GoogleMediaClient(transport).generate(request());
      expect(answer).toEqual({ media: [], text: "", costUsd: null });
      expect(sentBody(transport)).toMatchObject({
        generationConfig: {
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
        },
      });
    }
  });

  it("refuses an answer of the wrong shape", async () => {
    const error = await failureOf(
      new GoogleMediaClient(scripted(json({ candidates: 3 }))).generate(
        request(),
      ),
    );
    expect(error.detail).toBe("Antwort unlesbar");
  });

  it("uses the global fetch by default", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({}));
    await new GoogleMediaClient().generate(request());
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("GoogleMediaClient video", () => {
  const video = request({ kind: "video" });
  const client = (...responses: (Response | Error)[]): GoogleMediaClient =>
    new GoogleMediaClient(scripted(...responses), 0);
  const done = doneOperation;
  const file = videoFile;

  it("downloads a finished video and sends the options", async () => {
    const transport = scripted(
      done(`${GOOGLE}/files/a`),
      file("video/webm; x=1"),
    );
    const answer = await new GoogleMediaClient(transport, 0).generate(
      request({ kind: "video", aspectRatio: "9:16", durationSeconds: 6 }),
    );
    expect(answer.media[0]?.mimeType).toBe("video/webm");
    expect(answer.media[0]?.bytes.toString()).toBe("mp4");
    expect(sentBody(transport)).toMatchObject({
      parameters: { aspectRatio: "9:16", durationSeconds: 6 },
    });
  });

  it("sends no options when none are asked for", async () => {
    const transport = scripted(done(`${GOOGLE}/files/a`), file());
    const answer = await new GoogleMediaClient(transport, 0).generate(video);
    expect(answer.media[0]?.mimeType).toBe("video/mp4");
    expect(sentBody(transport)).toMatchObject({ parameters: {} });
  });

  it("falls back to mp4 for an unknown type", async () => {
    const answer = await client(
      done(`${GOOGLE}/files/a`),
      file("text/plain"),
    ).generate(video);
    expect(answer.media[0]?.mimeType).toBe("video/mp4");
  });
});

describe("GoogleMediaClient video operations", () => {
  const video = request({ kind: "video" });
  const client = (...responses: (Response | Error)[]): GoogleMediaClient =>
    new GoogleMediaClient(scripted(...responses), 0);
  const done = (uri?: string): Response => doneOperation(uri);
  const file = (type?: string): Response => videoFile(type);

  it("polls until the operation is done", async () => {
    const answer = await client(
      json({ name: "operations/1" }),
      json({ name: "operations/1", done: false }),
      done(`${GOOGLE}/files/a`),
      file("video/mp4"),
    ).generate(video);
    expect(answer.media).toHaveLength(1);
  });

  it("follows a storage redirect without the key", async () => {
    const transport = scripted(
      done(`${GOOGLE}/files/a`),
      new Response(null, { status: 302, headers: { location: "/store/x" } }),
      file("video/mp4"),
    );
    await new GoogleMediaClient(transport, 0).generate(video);
    const init = vi.mocked(transport).mock.calls[2];
    expect(init?.[0]).toBe("https://generativelanguage.googleapis.com/store/x");
    expect(init?.[1]).toMatchObject({ redirect: "follow" });
    expect(init?.[1]?.headers).toBeUndefined();
  });

  it("takes a redirect without location as the file", async () => {
    const answer = await client(
      done(`${GOOGLE}/files/a`),
      new Response("body", { status: 302 }),
    ).generate(video);
    expect(answer.media[0]?.bytes.toString()).toBe("body");
  });

  it("returns the filter reasons when no video came", async () => {
    const filtered = await client(done()).generate(video);
    expect(filtered).toEqual({
      media: [],
      text: "blocked unsafe",
      costUsd: null,
    });
    const bare = await client(
      json({ name: "operations/1", done: true }),
    ).generate(video);
    expect(bare.text).toBe("");
  });

  it("refuses an unreadable start or poll answer", async () => {
    for (const responses of [
      [json({ done: true })],
      [json({ name: 3 })],
      [json({ name: "operations/1" }), json({ name: 3 })],
    ]) {
      const error = await failureOf(client(...responses).generate(video));
      expect(error.detail).toBe("Antwort unlesbar");
    }
  });

  it("reports an error of the operation", async () => {
    const withMessage = await failureOf(
      client(
        json({ name: "o/1", done: true, error: { message: "bad" } }),
      ).generate(video),
    );
    expect(withMessage.detail).toBe("bad");
    const without = await failureOf(
      client(json({ name: "o/1", done: true, error: {} })).generate(video),
    );
    expect(without.detail).toBe("");
  });

  it("refuses a download address outside the Gemini API", async () => {
    for (const uri of ["https://evil.test/f", "not a url"]) {
      const error = await failureOf(client(done(uri)).generate(video));
      expect(error.detail).toBe("Unbekannte Download-Adresse");
    }
  });
});
