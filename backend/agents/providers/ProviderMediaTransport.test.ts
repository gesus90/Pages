import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentMediaError } from "@/backend/error/AgentMediaError";

import {
  DEFAULT_PCM_RATE,
  boundedDetail,
  isRawPcm,
  isRedirect,
  pcmRateOf,
  pcmToWav,
  readMediaBytes,
  readMediaJson,
  sendMediaRequest,
  waitForProvider,
} from "@/backend/agents/providers/ProviderMediaTransport";
import type * as MediaModule from "@/definition/AgentMediaGeneration";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

vi.mock("@/definition/AgentMediaGeneration", async (importOriginal) => {
  const original = await importOriginal<typeof MediaModule>();
  return {
    ...original,
    AGENT_MEDIA_LIMITS: { ...original.AGENT_MEDIA_LIMITS, answerBytes: 50 },
  };
});

const SMALL = new AbortController().signal;

function transportFor(response: Response | Error): typeof fetch {
  return vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response),
  );
}

async function failureOf(promise: Promise<unknown>): Promise<AgentMediaError> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof AgentMediaError)) throw new Error("no media error");
  return error;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("boundedDetail", () => {
  it("trims, redacts and shortens a text", () => {
    expect(boundedDetail("  hi  ")).toBe("hi");
    expect(boundedDetail("x".repeat(400))).toHaveLength(300);
    expect(boundedDetail("Bearer abcdefgh")).toBe("[redacted]");
  });
});

describe("sendMediaRequest", () => {
  const request = { url: "https://example.test/x", init: { method: "GET" } };

  it("returns a successful answer and refuses redirects by default", async () => {
    const transport = transportFor(new Response("{}", { status: 200 }));
    const response = await sendMediaRequest("p", request, transport);
    expect(response.status).toBe(200);
    expect(transport).toHaveBeenCalledWith(request.url, {
      redirect: "error",
      method: "GET",
    });
  });

  it("accepts a redirect answer", async () => {
    const redirect = new Response(null, { status: 302 });
    expect(await sendMediaRequest("p", request, transportFor(redirect))).toBe(
      redirect,
    );
  });

  it("reports the message of an error answer", async () => {
    const body = JSON.stringify({ error: { message: "nope" } });
    const error = await failureOf(
      sendMediaRequest(
        "p",
        request,
        transportFor(new Response(body, { status: 400 })),
      ),
    );
    expect([error.code, error.detail]).toEqual(["provider_failed", "nope"]);
  });

  it("keeps the status for an error without a usable body", async () => {
    for (const body of ["not json", '{"error":1}']) {
      const error = await failureOf(
        sendMediaRequest(
          "p",
          request,
          transportFor(new Response(body, { status: 500 })),
        ),
      );
      expect(error.detail).toBe("HTTP 500");
    }
  });

  it("refuses an answer that states a too large length", async () => {
    const response = new Response("{}", {
      headers: { "content-length": "51" },
    });
    const error = await failureOf(
      sendMediaRequest("p", request, transportFor(response)),
    );
    expect(error.detail).toBe("Antwort zu groß");
  });

  it("accepts an answer without a stated length", async () => {
    const response = new Response("{}", { headers: { "content-length": "x" } });
    expect(await sendMediaRequest("p", request, transportFor(response))).toBe(
      response,
    );
  });

  it("maps a failed transport to unreachable", async () => {
    const error = await failureOf(
      sendMediaRequest("p", request, transportFor(new Error("down"))),
    );
    expect([error.code, error.detail]).toEqual(["provider_unreachable", ""]);
  });

  it("names the timeout of an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await failureOf(
      sendMediaRequest(
        "p",
        { url: request.url, init: { signal: controller.signal } },
        transportFor(new Error("aborted")),
      ),
    );
    expect(error.detail).toBe("Zeit abgelaufen");
  });
});

describe("isRedirect", () => {
  it("is true only for 3xx statuses", () => {
    expect(isRedirect(new Response(null, { status: 301 }))).toBe(true);
    expect(isRedirect(new Response(null, { status: 200 }))).toBe(false);
    expect(isRedirect(new Response(null, { status: 404 }))).toBe(false);
  });
});

describe("readMediaJson", () => {
  it("parses a JSON answer", async () => {
    expect(await readMediaJson(new Response('{"a":1}'))).toEqual({ a: 1 });
  });

  it("refuses a too large and an unreadable answer", async () => {
    const large = await failureOf(readMediaJson(new Response("x".repeat(51))));
    expect(large.detail).toBe("Antwort zu groß");
    const broken = await failureOf(readMediaJson(new Response("nope")));
    expect(broken.detail).toBe("Antwort ist kein JSON");
  });
});

describe("readMediaBytes", () => {
  it("reads the bytes of a file", async () => {
    expect((await readMediaBytes(new Response("abc"))).toString()).toBe("abc");
  });

  it("refuses a too large file", async () => {
    const error = await failureOf(readMediaBytes(new Response("x".repeat(51))));
    expect(error.code).toBe("provider_failed");
  });
});

describe("PCM helpers", () => {
  it("reads the named rate or falls back to the default", () => {
    expect(pcmRateOf("audio/L16;codec=pcm;rate=16000")).toBe(16_000);
    expect(pcmRateOf("audio/L16")).toBe(DEFAULT_PCM_RATE);
    expect(pcmRateOf("audio/L16;rate=0")).toBe(DEFAULT_PCM_RATE);
  });

  it("recognizes raw PCM types", () => {
    expect(isRawPcm("Audio/L16;rate=1")).toBe(true);
    expect(isRawPcm("audio/pcm")).toBe(true);
    expect(isRawPcm("audio/wav")).toBe(false);
  });

  it("wraps samples into a WAV container", () => {
    const wav = pcmToWav(Buffer.from([1, 2, 3, 4]), 8000);
    expect(wav).toHaveLength(48);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(8000);
    expect(wav.readUInt32LE(28)).toBe(16_000);
    expect(wav.readUInt32LE(40)).toBe(4);
  });
});

describe("waitForProvider", () => {
  it("resolves after the wait", async () => {
    vi.useFakeTimers();
    const waiting = waitForProvider(1000, SMALL);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(waiting).resolves.toBeUndefined();
  });

  it("rejects at once for an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await failureOf(waitForProvider(1000, controller.signal));
    expect(error.code).toBe("provider_unreachable");
  });

  it("rejects when the signal aborts during the wait", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = failureOf(waitForProvider(1000, controller.signal));
    controller.abort();
    expect((await waiting).detail).toBe("Zeit abgelaufen");
  });
});
