import { describe, expect, it, vi } from "vitest";

import {
  ProviderHttpClient,
  requestHeaders,
} from "@/backend/agents/providers/ProviderHttpClient";

import type {
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "@/backend/agents/providers/ProviderContracts";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

function respond(status: number, body: unknown): ProviderHttpResponse {
  return { status, json: () => Promise.resolve(body) };
}

interface TestRequest {
  readonly provider: "openai";
  readonly apiKey: string;
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly parse: (payload: unknown) => string | null;
}

function request(body?: Record<string, unknown>): TestRequest {
  return {
    provider: "openai",
    apiKey: "secret",
    path: "/models",
    body,
    parse: (payload) => (payload === "bad" ? null : "parsed"),
  };
}

function clientFor(transport: ProviderHttpTransport): ProviderHttpClient {
  return new ProviderHttpClient(transport);
}

describe("requestHeaders", () => {
  it("uses the native header of each provider", () => {
    expect(requestHeaders("google_ai_studio", "k")["x-goog-api-key"]).toBe("k");
    expect(requestHeaders("anthropic", "k")).toMatchObject({
      "x-api-key": "k",
      "anthropic-version": "2023-06-01",
    });
    expect(requestHeaders("openai", "k").Authorization).toBe("Bearer k");
  });
});

describe("ProviderHttpClient.read", () => {
  it("uses the global fetch by default", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await new ProviderHttpClient().read(
      request(),
      new AbortController().signal,
    );
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("sends GET without a body and returns the parsed value", async () => {
    const transport = vi.fn<ProviderHttpTransport>(() =>
      Promise.resolve(respond(200, {})),
    );
    const result = await clientFor(transport).read(
      request(),
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: true, value: "parsed" });
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      body: undefined,
      redirect: "error",
    });
  });

  it("sends POST with a JSON body and logs failures as warnings", async () => {
    const transport = vi.fn<ProviderHttpTransport>(() =>
      Promise.resolve(respond(500, {})),
    );
    const result = await clientFor(transport).read(
      request({ a: 1 }),
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: false, errorCode: "provider_unavailable" });
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: '{"a":1}',
    });
  });

  it("reports an unreachable provider", async () => {
    const result = await clientFor(() =>
      Promise.reject(new Error("down")),
    ).read(request(), new AbortController().signal);
    expect(result).toEqual({ ok: false, errorCode: "provider_unreachable" });
  });

  it("reports a timeout when aborted before the request", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await clientFor(() =>
      Promise.resolve(respond(200, {})),
    ).read(request(), controller.signal);
    expect(result).toEqual({ ok: false, errorCode: "check_timeout" });
  });

  it("classifies an unreadable body by status", async () => {
    const broken = (status: number): ProviderHttpResponse => ({
      status,
      json: () => Promise.reject(new Error("bad json")),
    });
    const signal = new AbortController().signal;
    expect(
      await clientFor(() => Promise.resolve(broken(429))).read(
        request(),
        signal,
      ),
    ).toEqual({ ok: false, errorCode: "provider_rate_limited" });
    expect(
      await clientFor(() => Promise.resolve(broken(200))).read(
        request(),
        signal,
      ),
    ).toEqual({ ok: false, errorCode: "provider_bad_response" });
  });
});

describe("ProviderHttpClient.read aborts", () => {
  it("reports a timeout when the body read is aborted", async () => {
    const controller = new AbortController();
    const result = await clientFor(() =>
      Promise.resolve({
        status: 200,
        json: () => {
          controller.abort();
          return Promise.reject(new Error("aborted"));
        },
      }),
    ).read(request(), controller.signal);
    expect(result).toEqual({ ok: false, errorCode: "check_timeout" });
  });

  it("reports a timeout when aborted after the body was read", async () => {
    const controller = new AbortController();
    const result = await clientFor(() =>
      Promise.resolve({
        status: 200,
        json: () => {
          controller.abort();
          return Promise.resolve({});
        },
      }),
    ).read(request(), controller.signal);
    expect(result).toEqual({ ok: false, errorCode: "check_timeout" });
  });

  it("rejects payloads the parser refuses", async () => {
    const result = await clientFor(() =>
      Promise.resolve(respond(200, "bad")),
    ).read(request(), new AbortController().signal);
    expect(result).toEqual({ ok: false, errorCode: "provider_bad_response" });
  });
});

describe("ProviderHttpClient.check", () => {
  const signal = new AbortController().signal;

  it("adds the endpoint host to a successful detail", async () => {
    const outcome = await clientFor(() =>
      Promise.resolve(respond(200, {})),
    ).check({ ...request(), parse: () => ({ modelCount: 2 }) }, signal);
    expect(outcome).toEqual({
      ok: true,
      detail: { modelCount: 2, endpoint: "api.openai.com" },
    });
  });

  it("adds the endpoint host to a failure", async () => {
    const outcome = await clientFor(() =>
      Promise.resolve(respond(401, {})),
    ).check({ ...request(), parse: () => ({}) }, signal);
    expect(outcome).toEqual({
      ok: false,
      errorCode: "provider_auth_failed",
      detail: { endpoint: "api.openai.com" },
    });
  });
});
