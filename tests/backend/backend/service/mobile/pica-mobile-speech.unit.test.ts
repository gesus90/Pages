import { afterEach, describe, expect, it, vi } from "vitest";

import { PagesPicaMobileSpeech } from "@/backend/service/mobile/speech/PagesPicaMobileSpeech";
import { PicaMobileSpeechHandler } from "@/backend/service/mobile/speech/PicaMobileSpeechHandler";
import {
  encodePicaMobileSpeech,
  isPicaMobileSpeechType,
  parsePicaMobileSpeechPayload,
} from "@/backend/service/mobile/speech/PicaMobileSpeechMessages";

import type { PicaMobilePlansHost } from "@/backend/service/mobile/plans/PicaMobilePlansHandler";
import type { PicaMobileSpeechClientMessage } from "@/backend/service/mobile/speech/PicaMobileSpeechMessages";
import type { PicaMobileSpeechProvider } from "@/backend/service/mobile/speech/PicaMobileSpeechProvider";
import type { User } from "@/definition/User";

const SESSION = { userId: "user", sessionToken: "token" };
const LIMITS = { maxDurationMs: 1000, mimeTypes: ["audio/wav"] as const };
const USER: User = {
  id: "user",
  username: "user",
  displayName: "User",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

function world(): {
  handler: PicaMobileSpeechHandler;
  host: PicaMobilePlansHost;
  provider: PicaMobileSpeechProvider;
  frames: string[];
} {
  const frames: string[] = [];
  const host: PicaMobilePlansHost = {
    session: () => SESSION,
    isOpen: () => true,
    send: (frame) => {
      frames.push(frame);
      return true;
    },
    reject: vi.fn(),
    rejectUnauthenticated: vi.fn(),
    acknowledge: vi.fn(),
    endSession: vi.fn(),
    reportFailure: vi.fn(),
    enqueue: vi.fn(),
  };
  const provider: PicaMobileSpeechProvider = {
    isAvailable: async () => true,
    readLimits: async () => ({ kind: "limits", limits: LIMITS }),
    transcribe: async () => ({
      kind: "result",
      outcome: { ok: true, text: "hello" },
    }),
  };
  return {
    handler: new PicaMobileSpeechHandler(provider, host),
    host,
    provider,
    frames,
  };
}

function start(id = "recording"): PicaMobileSpeechClientMessage {
  return {
    type: "speech_start",
    requestId: "start",
    payload: { id, mimeType: "audio/wav", durationMs: 100 },
  };
}
function chunk(index: number): PicaMobileSpeechClientMessage {
  return {
    type: "speech_chunk",
    requestId: "chunk",
    payload: {
      id: "recording",
      index,
      data: Buffer.from("audio").toString("base64"),
    },
  };
}
function finish(): PicaMobileSpeechClientMessage {
  return {
    type: "speech_finish",
    requestId: "finish",
    payload: { id: "recording", chunkCount: 1 },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("speech messages", () => {
  it("identifies, validates and encodes speech frames", () => {
    expect(isPicaMobileSpeechType("speech_start")).toBe(true);
    expect(isPicaMobileSpeechType("other")).toBe(false);
    expect(parsePicaMobileSpeechPayload("other", "r", {})).toBeNull();
    expect(
      parsePicaMobileSpeechPayload("speech_start", "r", { id: "bad id" }),
    ).toMatchObject({ ok: false, rejection: { requestId: "r" } });
    expect(parsePicaMobileSpeechPayload("speech_config_get", "r", {})).toEqual({
      ok: true,
      message: { type: "speech_config_get", requestId: "r", payload: {} },
    });
    expect(
      JSON.parse(
        encodePicaMobileSpeech(null, {
          type: "speech_error",
          payload: { id: null, code: "not_configured" },
        }),
      ),
    ).toMatchObject({ requestId: null, type: "speech_error" });
  });
});

describe("speech handler", () => {
  it("assembles ordered chunks, returns text and clears the audio", async () => {
    const { handler, provider, frames } = world();
    let audio: Buffer | undefined;
    vi.spyOn(provider, "transcribe").mockImplementation(
      async (session, recording) => {
        expect(session).toEqual(SESSION);
        audio = recording.audio;
        expect(audio.toString()).toBe("audio");
        return { kind: "result", outcome: { ok: true, text: "hello" } };
      },
    );
    await handler.handle(start());
    await handler.handle(chunk(0));
    await handler.handle(finish());
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect(JSON.parse(frames[0] ?? "{}")).toMatchObject({
      requestId: "finish",
      type: "speech_result",
      payload: { id: "recording", text: "hello" },
    });
    expect(audio?.equals(Buffer.alloc(5))).toBe(true);
    handler.stop();
  });

  it("remembers sequence errors, drops later chunks and repeats the error on finish", async () => {
    const { handler, frames } = world();
    await handler.handle(start());
    await handler.handle(chunk(1));
    await handler.handle(chunk(0));
    await handler.handle(finish());
    expect(frames.map((frame) => JSON.parse(frame))).toMatchObject([
      { requestId: "chunk", payload: { code: "invalid_sequence" } },
      { requestId: "finish", payload: { code: "invalid_sequence" } },
    ]);
  });

  it("expires an idle recording and allows another one", async () => {
    vi.useFakeTimers();
    const { handler, frames, host } = world();
    await handler.handle(start());
    vi.advanceTimersByTime(60_000);
    expect(JSON.parse(frames[0] ?? "{}")).toMatchObject({
      requestId: null,
      payload: { id: "recording", code: "invalid_sequence" },
    });
    await handler.handle(start("next"));
    expect(host.acknowledge).toHaveBeenCalledTimes(3);
    handler.stop();
  });

  it.each([
    ["audio/unknown", 100, "unsupported_format"],
    ["audio/wav", 1001, "too_long"],
  ])("refuses %s at %i milliseconds", async (mimeType, durationMs, code) => {
    const { handler, frames } = world();
    await handler.handle({
      type: "speech_start",
      requestId: "r",
      payload: { id: "recording", mimeType, durationMs },
    });
    expect(JSON.parse(frames[0] ?? "{}")).toMatchObject({ payload: { code } });
  });

  it("cancels recognition and suppresses its eventual result", async () => {
    const { handler, provider, frames } = world();
    let resolve:
      | ((result: {
          kind: "result";
          outcome: { ok: true; text: string };
        }) => void)
      | undefined;
    let signal: AbortSignal | undefined;
    vi.spyOn(provider, "transcribe").mockImplementation(
      (session, recording) => {
        expect(session).toEqual(SESSION);
        signal = recording.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    );
    await handler.handle(start());
    await handler.handle(chunk(0));
    await handler.handle(finish());
    await handler.handle({
      type: "speech_cancel",
      requestId: "cancel",
      payload: { id: "recording" },
    });
    expect(signal?.aborted).toBe(true);
    resolve?.({ kind: "result", outcome: { ok: true, text: "late" } });
    await Promise.resolve();
    expect(frames).toEqual([]);
  });
});

describe("Pages speech provider", () => {
  it("checks the session before reading limits and forwarding recordings", async () => {
    const getAuthenticatedUser = vi.fn(async () => USER);
    const limits = vi.fn(async () => LIMITS);
    const transcribe = vi.fn(async () => ({
      ok: true as const,
      text: "words",
    }));
    const provider = new PagesPicaMobileSpeech(async () => ({
      authService: { getAuthenticatedUser },
      speechRecognitionService: { limits, transcribe },
    }));
    const recording = {
      audio: Buffer.from("audio"),
      mimeType: "audio/wav",
      signal: new AbortController().signal,
    };
    expect(await provider.isAvailable(SESSION)).toBe(true);
    expect(await provider.transcribe(SESSION, recording)).toEqual({
      kind: "result",
      outcome: { ok: true, text: "words" },
    });
    expect(getAuthenticatedUser).toHaveBeenCalledWith("token");
    expect(transcribe).toHaveBeenCalledWith(recording);
  });

  it("ends a mismatched session and erases its recording without calling speech", async () => {
    const limits = vi.fn(async () => LIMITS);
    const transcribe = vi.fn(async () => ({
      ok: true as const,
      text: "words",
    }));
    const provider = new PagesPicaMobileSpeech(async () => ({
      authService: { getAuthenticatedUser: async () => USER },
      speechRecognitionService: { limits, transcribe },
    }));
    const recording = {
      audio: Buffer.from("audio"),
      mimeType: "audio/wav",
      signal: new AbortController().signal,
    };
    const session = { ...SESSION, userId: "other" };
    expect(await provider.isAvailable(session)).toBe(false);
    expect(await provider.transcribe(session, recording)).toEqual({
      kind: "sessionEnded",
    });
    expect(recording.audio.equals(Buffer.alloc(5))).toBe(true);
    expect(limits).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });
});
