import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readServiceStatusDetails,
  readServiceStatusLight,
} from "@/app/lib/service-status";
import {
  SERVICE_STATUS_DETAILS_PATH,
  SERVICE_STATUS_PATH,
  SERVICE_STATUS_VERSION,
} from "@/definition/ServiceStatus";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const LIGHT = { version: SERVICE_STATUS_VERSION, light: "yellow" };
const DETAILS = {
  ...LIGHT,
  services: [{ name: "pages-api", state: "active", lastStart: 1, restarts: 0 }],
  lastBackup: null,
};

describe("readServiceStatusLight", () => {
  it("asks the public path without caching and returns the light", async () => {
    fetchMock.mockResolvedValueOnce(json(LIGHT));

    await expect(
      readServiceStatusLight(new AbortController().signal),
    ).resolves.toBe("yellow");

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(SERVICE_STATUS_PATH);
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("ends the request when the caller is gone", async () => {
    fetchMock.mockResolvedValueOnce(json(LIGHT));
    const caller = new AbortController();

    await readServiceStatusLight(caller.signal);
    const signal = (fetchMock.mock.calls[0]?.[1] as RequestInit)
      .signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    caller.abort();

    expect(signal.aborted).toBe(true);
  });

  it.each([
    [
      "a failed connection",
      () => fetchMock.mockRejectedValueOnce(new Error("x")),
    ],
    [
      "a non-200 answer",
      () => fetchMock.mockResolvedValueOnce(json(LIGHT, 503)),
    ],
    [
      "an answer that is no JSON",
      () =>
        fetchMock.mockResolvedValueOnce(new Response("up", { status: 200 })),
    ],
    [
      "another version",
      () => fetchMock.mockResolvedValueOnce(json({ ...LIGHT, version: 99 })),
    ],
    [
      "an unknown light",
      () => fetchMock.mockResolvedValueOnce(json({ ...LIGHT, light: "blue" })),
    ],
  ])("answers null for %s", async (label, arrange) => {
    arrange();

    await expect(
      readServiceStatusLight(new AbortController().signal),
    ).resolves.toBeNull();
  });
});

describe("readServiceStatusDetails", () => {
  it("grants the services in detail on a confirmed 200", async () => {
    fetchMock.mockResolvedValueOnce(json(DETAILS));

    await expect(
      readServiceStatusDetails(new AbortController().signal),
    ).resolves.toEqual({ kind: "granted", details: DETAILS });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(SERVICE_STATUS_DETAILS_PATH);
  });

  it("is unreachable when a 200 carries no valid details", async () => {
    fetchMock.mockResolvedValueOnce(json(LIGHT));

    await expect(
      readServiceStatusDetails(new AbortController().signal),
    ).resolves.toEqual({ kind: "unreachable" });
  });

  it("is unreachable when no status can be read", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));

    await expect(
      readServiceStatusDetails(new AbortController().signal),
    ).resolves.toEqual({ kind: "unreachable" });
  });

  it("denies with only the light on 403", async () => {
    fetchMock.mockResolvedValueOnce(json(LIGHT, 403));

    await expect(
      readServiceStatusDetails(new AbortController().signal),
    ).resolves.toEqual({ kind: "denied", light: "yellow" });
  });

  it.each([401, 502, 503])(
    "leaves the session unconfirmed with only the light on %i",
    async (status) => {
      fetchMock.mockResolvedValueOnce(json(LIGHT, status));

      await expect(
        readServiceStatusDetails(new AbortController().signal),
      ).resolves.toEqual({ kind: "unconfirmed", light: "yellow" });
    },
  );

  it("is unreachable when a 200 answer has no content type at all", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      readServiceStatusDetails(new AbortController().signal),
    ).resolves.toEqual({ kind: "unreachable" });
  });

  it("is unreachable when a refusal carries no light", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("denied", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    await expect(
      readServiceStatusDetails(new AbortController().signal),
    ).resolves.toEqual({ kind: "unreachable" });
  });
});
