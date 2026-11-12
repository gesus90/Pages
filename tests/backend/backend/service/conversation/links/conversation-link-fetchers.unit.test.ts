import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HttpConversationLinkFetcher,
  isPublicAddress,
} from "@/backend/service/conversation/links/HttpConversationLinkFetcher";
import { SimulatedConversationLinkFetcher } from "@/backend/service/conversation/links/SimulatedConversationLinkFetcher";

import type {
  ConversationLinkRequest,
  ConversationLinkResponse,
} from "@/backend/service/conversation/links/HttpConversationLinkFetcher";

function response(
  overrides: Partial<ConversationLinkResponse> = {},
): ConversationLinkResponse {
  return {
    status: 200,
    contentType: "text/html; charset=utf-8",
    location: null,
    body: new TextEncoder().encode("<title>Example</title>"),
    isTruncated: false,
    ...overrides,
  };
}

const publicLookup = vi.fn(async () => [
  { address: "8.8.8.8", family: 4 as const },
]);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  publicLookup.mockClear();
});

describe("public address policy", () => {
  it.each([
    ["8.8.8.8", true],
    ["10.0.0.1", false],
    ["127.0.0.1", false],
    ["192.0.2.1", false],
    ["255.255.255.255", false],
    ["example.org", false],
    ["2001:4860:4860::8888", true],
    ["::1", false],
    ["fc00::1", false],
    ["2001:db8::1", false],
    ["::ffff:8.8.8.8", true],
    ["::ffff:127.0.0.1", false],
    ["64:ff9b::808:808", true],
    ["64:ff9b::a00:1", false],
  ])("classifies %s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});

describe("HTTP conversation link fetcher", () => {
  it("pins each redirect to its checked address and resolves images against the final URL", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ status: 302, location: "/article" }))
      .mockResolvedValueOnce(
        response({
          body: new TextEncoder().encode(
            '<title>News</title><meta property="og:image" content="image.png">',
          ),
        }),
      );
    const fetcher = new HttpConversationLinkFetcher({
      lookup: publicLookup,
      request,
      maximumBytes: 1234,
    });
    await expect(fetcher.fetch("https://example.org/start")).resolves.toEqual({
      title: "News",
      description: "",
      imageUrl: "https://example.org/image.png",
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toMatchObject({
      address: "8.8.8.8",
      family: 4,
      maximumBytes: 1234,
    });
    expect(request.mock.calls[1][0].url.href).toBe(
      "https://example.org/article",
    );
    expect(request.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it.each([
    "bad url",
    "ftp://example.org/",
    "https://user:pass@example.org/",
    "http://127.0.0.1/",
  ])("refuses unsafe URL %s", async (url) => {
    const request = vi.fn();
    const fetcher = new HttpConversationLinkFetcher({
      lookup: publicLookup,
      request,
    });
    await expect(fetcher.fetch(url)).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects empty or mixed public and private DNS answers", async () => {
    const request = vi.fn();
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]);
    const fetcher = new HttpConversationLinkFetcher({ lookup, request });
    await expect(fetcher.fetch("https://example.org")).resolves.toBeNull();
    await expect(fetcher.fetch("https://example.org")).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses unsafe, missing and excessive redirect destinations", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(response({ status: 302, location: "/again" }));
    const fetcher = new HttpConversationLinkFetcher({
      lookup: publicLookup,
      request,
    });
    await expect(fetcher.fetch("https://example.org")).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(4);
    request
      .mockClear()
      .mockResolvedValueOnce(
        response({ status: 301, location: "http://127.0.0.1" }),
      )
      .mockResolvedValueOnce(response({ status: 302, location: null }));
    await expect(fetcher.fetch("https://example.org")).resolves.toBeNull();
    await expect(fetcher.fetch("https://example.org")).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("HTTP response handling", () => {
  it("rejects unexpected status and media types and decodes an unknown charset as UTF-8", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ status: 404 }))
      .mockResolvedValueOnce(response({ contentType: "image/png" }))
      .mockResolvedValueOnce(
        response({ contentType: "TEXT/HTML; charset=unknown-charset" }),
      );
    const fetcher = new HttpConversationLinkFetcher({
      lookup: publicLookup,
      request,
    });
    await expect(fetcher.fetch("https://example.org")).resolves.toBeNull();
    await expect(fetcher.fetch("https://example.org")).resolves.toBeNull();
    await expect(fetcher.fetch("https://example.org")).resolves.toEqual({
      title: "Example",
      description: "",
      imageUrl: null,
    });
  });
});

describe("HTTP link images and failures", () => {
  it("returns only complete images within the byte limit", async () => {
    const bytes = new Uint8Array([1, 2]);
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        response({ contentType: "Image/PNG; x=y", body: bytes }),
      )
      .mockResolvedValueOnce(
        response({ contentType: "image/png", body: bytes, isTruncated: true }),
      )
      .mockResolvedValueOnce(
        response({ contentType: "image/png", body: new Uint8Array(4) }),
      )
      .mockResolvedValueOnce(response({ contentType: "text/html" }));
    const fetcher = new HttpConversationLinkFetcher({
      lookup: publicLookup,
      request,
      maximumBytes: 3,
    });
    await expect(fetcher.fetchImage("https://example.org")).resolves.toEqual({
      bytes,
      mimeType: "image/png",
    });
    for (let index = 0; index < 3; index += 1) {
      await expect(
        fetcher.fetchImage("https://example.org"),
      ).resolves.toBeNull();
    }
  });

  it("times out a stalled lookup and aborts a stalled request", async () => {
    vi.useFakeTimers();
    const stalledLookup = new HttpConversationLinkFetcher({
      lookup: () => new Promise(() => {}),
      timeoutMilliseconds: 10,
    });
    const lookupResult = stalledLookup.fetch("https://example.org");
    await vi.advanceTimersByTimeAsync(10);
    await expect(lookupResult).resolves.toBeNull();
    const request = vi
      .fn<
        (input: ConversationLinkRequest) => Promise<ConversationLinkResponse>
      >()
      .mockImplementation(() => new Promise(() => {}));
    const stalledRequest = new HttpConversationLinkFetcher({
      lookup: publicLookup,
      request,
      timeoutMilliseconds: 10,
    });
    const requestResult = stalledRequest.fetch("https://example.org");
    await vi.advanceTimersByTimeAsync(10);
    await expect(requestResult).resolves.toBeNull();
    expect(request.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it("returns null for remote failures", async () => {
    const error = Object.assign(new Error("unreachable"), {
      code: "ECONNREFUSED",
    });
    const fetcher = new HttpConversationLinkFetcher({
      lookup: publicLookup,
      request: vi.fn().mockRejectedValue(error),
    });
    await expect(fetcher.fetch("https://example.org")).resolves.toBeNull();
  });
});

describe("simulated conversation link fetcher", () => {
  it("derives a deterministic preview and never fetches an image", async () => {
    const fetcher = new SimulatedConversationLinkFetcher();
    await expect(
      fetcher.fetch("https://example.org:8443/path?q=1"),
    ).resolves.toEqual({
      title: "Vorschau von example.org:8443",
      description: "Simulierte Vorschau der Seite /path",
      imageUrl: null,
    });
    await expect(fetcher.fetchImage()).resolves.toBeNull();
  });

  it.each(["not a URL", "ftp://example.org", "https://test.invalid/"])(
    "refuses %s",
    async (url) => {
      await expect(
        new SimulatedConversationLinkFetcher().fetch(url),
      ).resolves.toBeNull();
    },
  );
});
