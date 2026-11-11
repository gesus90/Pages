import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchPicaBrowserFrame,
  fetchPicaBrowsers,
  PicaBrowserClientError,
  picaBrowserDownloadUrl,
  sendPicaBrowserCommand,
} from "@/app/lib/pica-browser-client";

const BROWSER_ID = "8f6f3a1e-8a54-4b43-9a6c-2f2c6c7d9b10";
const VIEW = {
  browserId: BROWSER_ID,
  task: "Check the invoice",
  state: "running",
  url: "https://example.test/",
  title: "Example",
  device: "desktop",
  width: 1280,
  height: 800,
  frameVersion: 3,
  tabs: [],
  actions: [],
  downloads: [],
  handoverReason: null,
  profile: null,
  areLocalWritesApproved: false,
  updatedAt: "2026-11-11T10:00:00.000Z",
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function jsonAnswer(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), init);
}

/** The error a call rejected with, so its code can be asserted. */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    expect(error).toBeInstanceOf(PicaBrowserClientError);
    return (error as PicaBrowserClientError).code;
  }
  throw new Error("The call did not reject");
}

describe("fetchPicaBrowsers", () => {
  it("posts the overview intent and returns browsers and saved sessions", async () => {
    const savedSessions = [
      {
        name: "Work",
        origins: ["https://example.test"],
        savedAt: "2026-11-10",
      },
    ];
    fetchMock.mockResolvedValueOnce(
      jsonAnswer({ ok: true, browsers: [VIEW], savedSessions }),
    );
    const signal = new AbortController().signal;

    const overview = await fetchPicaBrowsers(signal);

    expect(overview).toEqual({ browsers: [VIEW], savedSessions });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/chat-browser-api");
    expect(init.method).toBe("POST");
    expect(init.signal).toBe(signal);
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ intent: "overview" });
  });

  it("sends no signal when none is given", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonAnswer({ ok: true, browsers: [], savedSessions: [] }),
    );

    await fetchPicaBrowsers();

    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("signal");
  });

  it("reports NETWORK when the request cannot be sent", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));

    expect(await codeOf(fetchPicaBrowsers())).toBe("NETWORK");
  });

  it("reports BROWSER_FAILED when the answer is no JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));

    expect(await codeOf(fetchPicaBrowsers())).toBe("BROWSER_FAILED");
  });

  it("passes on the stable code the server sent", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonAnswer({ ok: false, error: "FORBIDDEN" }, { status: 403 }),
    );

    expect(await codeOf(fetchPicaBrowsers())).toBe("FORBIDDEN");
  });

  it("falls back to BROWSER_FAILED for an unsuccessful answer without a code", async () => {
    fetchMock.mockResolvedValueOnce(jsonAnswer({ ok: true }, { status: 500 }));
    fetchMock.mockResolvedValueOnce(jsonAnswer({ ok: false, error: 7 }));
    fetchMock.mockResolvedValueOnce(jsonAnswer([1, 2]));

    expect(await codeOf(fetchPicaBrowsers())).toBe("BROWSER_FAILED");
    expect(await codeOf(fetchPicaBrowsers())).toBe("BROWSER_FAILED");
    expect(await codeOf(fetchPicaBrowsers())).toBe("BROWSER_FAILED");
  });

  it("rejects an overview of an unexpected shape", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonAnswer({
        ok: true,
        browsers: [{ browserId: "x" }],
        savedSessions: [],
      }),
    );

    expect(await codeOf(fetchPicaBrowsers())).toBe("BROWSER_FAILED");
  });
});

describe("sendPicaBrowserCommand", () => {
  it("posts the command for the browser and returns the browser afterwards", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonAnswer({ ok: true, browser: { ...VIEW, state: "paused" } }),
    );

    const view = await sendPicaBrowserCommand(BROWSER_ID, {
      command: "pause",
    });

    expect(view.state).toBe("paused");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      intent: "command",
      browserId: BROWSER_ID,
      command: { command: "pause" },
    });
  });

  it("rejects a browser view of an unexpected shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonAnswer({ ok: true, browser: {} }));

    expect(
      await codeOf(sendPicaBrowserCommand(BROWSER_ID, { command: "stop" })),
    ).toBe("BROWSER_FAILED");
  });

  it("passes on a refusal of the server", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonAnswer({ ok: false, error: "NOT_TAKEN_OVER" }, { status: 409 }),
    );

    expect(
      await codeOf(sendPicaBrowserCommand(BROWSER_ID, { command: "stop" })),
    ).toBe("NOT_TAKEN_OVER");
  });
});

describe("fetchPicaBrowserFrame", () => {
  it("returns an object URL and the frame version of the newest picture", async () => {
    const createObjectURL = vi.fn(() => "blob:frame-1");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }));
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(["png"]), { headers: { "X-Frame-Version": "7" } }),
    );
    const signal = new AbortController().signal;

    const frame = await fetchPicaBrowserFrame("a b/c", signal);

    expect(frame).toEqual({ url: "blob:frame-1", version: 7 });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/chat/browser/a%20b%2Fc/frame", {
      cache: "no-store",
      signal,
    });
  });

  it("uses version 0 without a version header and sends no signal when none is given", async () => {
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x") }),
    );
    fetchMock.mockResolvedValueOnce(new Response(new Blob(["png"])));

    const frame = await fetchPicaBrowserFrame(BROWSER_ID);

    expect(frame?.version).toBe(0);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ cache: "no-store" });
  });

  it("answers null while no picture exists", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(fetchPicaBrowserFrame(BROWSER_ID)).resolves.toBeNull();
  });

  it("rejects when the server refuses the picture", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 404 }));

    expect(await codeOf(fetchPicaBrowserFrame(BROWSER_ID))).toBe(
      "BROWSER_FAILED",
    );
  });
});

describe("picaBrowserDownloadUrl", () => {
  it("encodes both ids into the download address", () => {
    expect(picaBrowserDownloadUrl("b/1", "d 2")).toBe(
      "/chat/browser/b%2F1/downloads/d%202",
    );
  });
});
