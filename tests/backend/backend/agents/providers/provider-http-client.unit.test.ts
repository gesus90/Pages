import { beforeEach, expect, it, vi } from "vitest";

import {
  ProviderHttpClient,
  requestHeaders,
} from "@/backend/agents/providers/ProviderHttpClient";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import type {
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "@/backend/agents/providers/ProviderContracts";
import type { AgentCheckDetail } from "@/definition/AgentConnection";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const ENDPOINT_DETAIL = { endpoint: "openrouter.ai" };

function jsonResponse(status: number, payload: unknown): ProviderHttpResponse {
  return { status, json: async () => payload };
}

function transportReturning(
  response: ProviderHttpResponse,
): ReturnType<typeof vi.fn<ProviderHttpTransport>> {
  return vi.fn<ProviderHttpTransport>(async () => response);
}

function check(
  transport: ProviderHttpTransport,
  signal: AbortSignal = new AbortController().signal,
  parse: (payload: unknown) => AgentCheckDetail | null = () => ({
    modelCount: 2,
  }),
): ReturnType<ProviderHttpClient["check"]> {
  return new ProviderHttpClient(transport).check(
    { provider: "openrouter", apiKey: "synthetic-key", path: "/key", parse },
    signal,
  );
}

beforeEach(() => {
  vi.mocked(logCaughtError).mockClear();
  vi.mocked(logEvent).mockClear();
});

it("builds provider-native authentication headers", () => {
  expect(requestHeaders("google_ai_studio", "k")).toMatchObject({
    "x-goog-api-key": "k",
  });
  expect(requestHeaders("anthropic", "k")).toEqual({
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-api-key": "k",
    "anthropic-version": "2023-06-01",
  });
  expect(requestHeaders("openai", "k")).toMatchObject({
    Authorization: "Bearer k",
  });
});

it("sends a GET without body and returns sanitized detail plus the endpoint host", async () => {
  const transport = transportReturning(jsonResponse(200, {}));
  const outcome = await check(transport, undefined, () => ({
    modelCount: 2,
    model: "bad model name with spaces",
  }));
  expect(outcome).toEqual({
    ok: true,
    detail: { modelCount: 2, ...ENDPOINT_DETAIL },
  });
  expect(transport).toHaveBeenCalledWith(
    "https://openrouter.ai/api/v1/key",
    expect.objectContaining({
      method: "GET",
      body: undefined,
      redirect: "error",
    }),
  );
  expect(vi.mocked(logEvent).mock.calls[0]?.[0].level).toBe("debug");
});

it("posts a JSON body and logs rejected statuses as warnings", async () => {
  const transport = transportReturning(jsonResponse(401, {}));
  const outcome = await new ProviderHttpClient(transport).check(
    {
      provider: "openai",
      apiKey: "synthetic-key",
      path: "/chat/completions",
      body: { model: "m" },
      parse: () => null,
    },
    new AbortController().signal,
  );
  expect(outcome).toEqual({
    ok: false,
    errorCode: "provider_auth_failed",
    detail: { endpoint: "api.openai.com" },
  });
  expect(transport.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    body: '{"model":"m"}',
  });
  expect(vi.mocked(logEvent).mock.calls[0]?.[0].level).toBe("warn");
});

it("reports an unreachable provider when the transport throws", async () => {
  const transport = vi.fn<ProviderHttpTransport>(async () => {
    throw new Error("offline");
  });
  expect(await check(transport)).toEqual({
    ok: false,
    errorCode: "provider_unreachable",
    detail: ENDPOINT_DETAIL,
  });
  expect(logCaughtError).toHaveBeenCalledWith(
    "ProviderHttpClient",
    expect.any(Error),
  );
});

it("reports a timeout without sending when the signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const transport = transportReturning(jsonResponse(200, {}));
  expect(await check(transport, controller.signal)).toMatchObject({
    ok: false,
    errorCode: "check_timeout",
  });
  expect(transport).not.toHaveBeenCalled();
});

it("classifies an unreadable body by status or as a bad response", async () => {
  const unreadable = (status: number): ProviderHttpResponse => ({
    status,
    json: async () => {
      throw new SyntaxError("not json");
    },
  });
  expect(await check(transportReturning(unreadable(429)))).toMatchObject({
    errorCode: "provider_rate_limited",
  });
  expect(await check(transportReturning(unreadable(200)))).toMatchObject({
    errorCode: "provider_bad_response",
  });
});

it("reports a timeout when the body read fails after the abort", async () => {
  const controller = new AbortController();
  const response: ProviderHttpResponse = {
    status: 200,
    json: async () => {
      controller.abort();
      throw new Error("aborted");
    },
  };
  expect(
    await check(transportReturning(response), controller.signal),
  ).toMatchObject({ errorCode: "check_timeout" });
});

it("reports a timeout when the abort arrives while the body is read", async () => {
  const controller = new AbortController();
  const response: ProviderHttpResponse = {
    status: 200,
    json: async () => {
      controller.abort();
      return {};
    },
  };
  expect(
    await check(transportReturning(response), controller.signal),
  ).toMatchObject({ errorCode: "check_timeout" });
});

it("rejects a successful status whose payload the adapter cannot read", async () => {
  expect(
    await check(
      transportReturning(jsonResponse(200, {})),
      undefined,
      () => null,
    ),
  ).toEqual({
    ok: false,
    errorCode: "provider_bad_response",
    detail: ENDPOINT_DETAIL,
  });
});
