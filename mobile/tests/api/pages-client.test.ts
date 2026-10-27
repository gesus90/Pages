import {
  HttpStatusError,
  InvalidResponseError,
  NetworkError,
  RequestAbortedError,
  RequestTimeoutError,
} from "@/api/api-error";
import { PagesClient } from "@/api/pages-client";

import type { AuthProvider } from "@/api/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseName(value: unknown): string {
  if (typeof value === "object" && value !== null && "name" in value) {
    return String(value.name);
  }

  throw new Error("no name");
}

describe("PagesClient", () => {
  it("requests the path below the base address and parses the JSON", async () => {
    const fetchImplementation = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(jsonResponse({ name: "pica" }));
    const client = new PagesClient({
      baseUrl: "https://pages.example.com",
      fetchImplementation,
    });

    await expect(client.getJson("/health", parseName)).resolves.toBe("pica");

    const [url, init] = fetchImplementation.mock.calls[0] ?? [];

    expect(url).toBe("https://pages.example.com/health");
    expect(init?.headers).toEqual({ Accept: "application/json" });
  });

  it("sends the authorization the provider supplies, and none by default", async () => {
    const fetchImplementation = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockImplementation(() => Promise.resolve(jsonResponse({ name: "x" })));
    const auth: AuthProvider = {
      getAuthorizationHeader: () => Promise.resolve("Bearer token"),
    };

    await new PagesClient({
      baseUrl: "https://a.example.com",
      auth,
      fetchImplementation,
    }).getJson("/", parseName);
    await new PagesClient({
      baseUrl: "https://a.example.com",
      fetchImplementation,
    }).getJson("/", parseName);

    expect(fetchImplementation.mock.calls[0]?.[1]?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer token",
    });
    expect(fetchImplementation.mock.calls[1]?.[1]?.headers).toEqual({
      Accept: "application/json",
    });
  });

  it("maps an error status to HttpStatusError with the JSON body", async () => {
    const client = new PagesClient({
      baseUrl: "https://a.example.com",
      fetchImplementation: () =>
        Promise.resolve(jsonResponse({ status: "unavailable" }, 503)),
    });

    await expect(client.getJson("/health", parseName)).rejects.toMatchObject({
      kind: "http",
      status: 503,
      body: { status: "unavailable" },
    });
  });

  it("flags 401 and 403 as unauthorized", async () => {
    const client = new PagesClient({
      baseUrl: "https://a.example.com",
      fetchImplementation: () =>
        Promise.resolve(new Response("denied", { status: 401 })),
    });
    const error: unknown = await client
      .getJson("/", parseName)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error).toMatchObject({ isUnauthorized: true, body: null });
  });

  it("rejects an answer that is not JSON or has the wrong shape", async () => {
    const notJson = new PagesClient({
      baseUrl: "https://a.example.com",
      fetchImplementation: () => Promise.resolve(new Response("<html>")),
    });
    const wrongShape = new PagesClient({
      baseUrl: "https://a.example.com",
      fetchImplementation: () => Promise.resolve(jsonResponse({ other: 1 })),
    });

    await expect(notJson.getJson("/", parseName)).rejects.toBeInstanceOf(
      InvalidResponseError,
    );
    await expect(wrongShape.getJson("/", parseName)).rejects.toBeInstanceOf(
      InvalidResponseError,
    );
  });
});

describe("PagesClient failures", () => {
  it("maps a failed connection to NetworkError", async () => {
    const client = new PagesClient({
      baseUrl: "https://a.example.com",
      fetchImplementation: () =>
        Promise.reject(new TypeError("Network request failed")),
    });

    await expect(client.getJson("/", parseName)).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("times out when the server does not answer", async () => {
    jest.useFakeTimers();

    try {
      const client = new PagesClient({
        baseUrl: "https://a.example.com",
        timeoutMilliseconds: 50,
        fetchImplementation: (url, init) =>
          new Promise<Response>((resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      });
      const request = client.getJson("/", parseName);
      const outcome = request.catch((caught: unknown) => caught);

      await jest.advanceTimersByTimeAsync(60);

      await expect(outcome).resolves.toBeInstanceOf(RequestTimeoutError);
    } finally {
      jest.useRealTimers();
    }
  });

  it("times out when the server sends the headers and then stalls", async () => {
    jest.useFakeTimers();

    try {
      const client = new PagesClient({
        baseUrl: "https://a.example.com",
        timeoutMilliseconds: 50,
        fetchImplementation: () =>
          Promise.resolve(
            new Response(new ReadableStream({ start: () => undefined })),
          ),
      });
      const outcome = client
        .getJson("/", parseName)
        .catch((caught: unknown) => caught);

      await jest.advanceTimersByTimeAsync(60);

      await expect(outcome).resolves.toBeInstanceOf(RequestTimeoutError);
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops when the caller aborts, before and during the request", async () => {
    const controller = new AbortController();
    const client = new PagesClient({
      baseUrl: "https://a.example.com",
      fetchImplementation: (url, init) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    });
    const running = client
      .getJson("/", parseName, { signal: controller.signal })
      .catch((caught: unknown) => caught);

    await Promise.resolve();
    controller.abort();

    await expect(running).resolves.toBeInstanceOf(RequestAbortedError);
    await expect(
      client.getJson("/", parseName, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(RequestAbortedError);
  });

  it("sends nothing when the caller aborts while the credentials resolve", async () => {
    const controller = new AbortController();
    const fetchImplementation = jest.fn<
      Promise<Response>,
      Parameters<typeof fetch>
    >();
    let release: (header: string | null) => void = () => undefined;
    const auth: AuthProvider = {
      getAuthorizationHeader: () =>
        new Promise<string | null>((resolve) => {
          release = resolve;
        }),
    };
    const client = new PagesClient({
      baseUrl: "https://a.example.com",
      fetchImplementation,
      auth,
    });
    const running = client
      .getJson("/", parseName, { signal: controller.signal })
      .catch((caught: unknown) => caught);

    controller.abort();
    release("Bearer token");

    await expect(running).resolves.toBeInstanceOf(RequestAbortedError);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
