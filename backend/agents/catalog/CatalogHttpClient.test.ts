import { describe, expect, it, vi } from "vitest";

import { CatalogHttpClient } from "@/backend/agents/catalog/CatalogHttpClient";
import { AgentError } from "@/backend/error/AgentErrors";

vi.mock("@/backend/logging/Logger", () => ({
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
}));

function input(
  signal: AbortSignal = new AbortController().signal,
  remainingBytes = 1_000_000,
): Parameters<CatalogHttpClient["get"]>[0] {
  return {
    provider: "openai",
    apiKey: "secret",
    path: "/models",
    signal,
    remainingBytes,
  };
}

function clientFor(response: Response | Error): CatalogHttpClient {
  return new CatalogHttpClient(
    vi.fn(() =>
      response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(response),
    ),
  );
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  return error instanceof AgentError ? error.code : error;
}

describe("CatalogHttpClient.get", () => {
  it("returns the parsed payload and the bytes read", async () => {
    const request = vi.fn(() =>
      Promise.resolve(new Response('{"data":[]}', { status: 200 })),
    );
    const result = await new CatalogHttpClient(request).get(input());
    expect(result).toEqual({ payload: { data: [] }, bytes: 11 });
    expect(request).toHaveBeenCalledOnce();
  });

  it("uses the global fetch by default", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await new CatalogHttpClient().get(input());
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("classifies an error status by its structured body", async () => {
    const body = JSON.stringify({ error: { code: "API_KEY_INVALID" } });
    expect(
      await codeOf(clientFor(new Response(body, { status: 400 })).get(input())),
    ).toBe("provider_auth_failed");
  });

  it("falls back to the status when the error body is unreadable", async () => {
    expect(
      await codeOf(
        clientFor(new Response("<html>", { status: 503 })).get(input()),
      ),
    ).toBe("provider_unavailable");
    expect(
      await codeOf(clientFor(new Response(null, { status: 503 })).get(input())),
    ).toBe("provider_unavailable");
  });

  it("rejects a failure the status table does not classify", async () => {
    expect(
      await codeOf(clientFor(new Response("{}", { status: 302 })).get(input())),
    ).toBe("provider_bad_response");
    const unclassified = new Response("{}", { status: 200 });
    Object.defineProperty(unclassified, "ok", { value: false });
    expect(await codeOf(clientFor(unclassified).get(input()))).toBe(
      "provider_bad_response",
    );
  });

  it("rejects a structured error inside a successful response", async () => {
    const body = JSON.stringify({ error: { code: "429" } });
    expect(
      await codeOf(clientFor(new Response(body, { status: 200 })).get(input())),
    ).toBe("provider_rate_limited");
  });

  it("rejects a response without a body or with invalid JSON", async () => {
    expect(
      await codeOf(clientFor(new Response(null, { status: 200 })).get(input())),
    ).toBe("provider_bad_response");
    expect(
      await codeOf(clientFor(new Response("{", { status: 200 })).get(input())),
    ).toBe("provider_bad_response");
  });

  it("limits the bytes it reads", async () => {
    expect(
      await codeOf(
        clientFor(new Response("0123456789", { status: 200 })).get(
          input(undefined, 5),
        ),
      ),
    ).toBe("catalog_limit_exceeded");
  });

  it("maps transport failures", async () => {
    expect(await codeOf(clientFor(new TypeError("down")).get(input()))).toBe(
      "provider_unreachable",
    );
  });

  it("reports an aborted request as a timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await codeOf(
        clientFor(new Response("{}", { status: 200 })).get(
          input(controller.signal),
        ),
      ),
    ).toBe("check_timeout");
  });

  it("stops after a body read when the signal aborted meanwhile", async () => {
    const controller = new AbortController();
    const request = vi.fn(() => {
      controller.abort();
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    expect(
      await codeOf(
        new CatalogHttpClient(request).get(input(controller.signal)),
      ),
    ).toBe("check_timeout");
  });
});
