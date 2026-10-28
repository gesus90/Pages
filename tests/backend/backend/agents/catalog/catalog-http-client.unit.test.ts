import { afterEach, expect, it, vi } from "vitest";

import { CatalogHttpClient } from "@/backend/agents/catalog/CatalogHttpClient";
import { classifyProviderError } from "@/backend/agents/providers/ProviderErrors";
import { AgentError } from "@/backend/error/AgentErrors";

const ANY_SIGNAL: unknown = expect.any(AbortSignal);

const logging = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => logging);
vi.mock(
  import("@/backend/agents/providers/ProviderErrors"),
  async (importOriginal) => {
    const original = await importOriginal();
    return {
      ...original,
      classifyProviderError: vi.fn(original.classifyProviderError),
    };
  },
);

afterEach(() => {
  logging.logCaughtError.mockReset();
  logging.logEvent.mockReset();
  vi.unstubAllGlobals();
});

function input(
  overrides: Partial<Parameters<CatalogHttpClient["get"]>[0]> = {},
): Parameters<CatalogHttpClient["get"]>[0] {
  return {
    provider: "openai",
    apiKey: "secret-key",
    path: "/models",
    signal: new AbortController().signal,
    remainingBytes: 1_000_000,
    ...overrides,
  };
}

it("reads a bounded JSON page with a single metadata GET", async () => {
  const request = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));

  await expect(new CatalogHttpClient(request).get(input())).resolves.toEqual({
    payload: { data: [] },
    bytes: 11,
  });

  expect(request).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer secret-key",
    },
    signal: ANY_SIGNAL,
    redirect: "error",
  });
  expect(logging.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "debug",
      metadata: { provider: "openai", statusCode: 200 },
    }),
  );
});

it("uses the global fetch when no transport is given", async () => {
  const request = vi.fn<typeof fetch>(async () => Response.json([]));
  vi.stubGlobal("fetch", request);

  await expect(new CatalogHttpClient().get(input())).resolves.toMatchObject({
    payload: [],
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it("refuses to start after the deadline", async () => {
  const request = vi.fn<typeof fetch>();

  await expect(
    new CatalogHttpClient(request).get(input({ signal: AbortSignal.abort() })),
  ).rejects.toMatchObject({ code: "check_timeout" });
  expect(request).not.toHaveBeenCalled();
});

it("reports a deadline that passed while the body arrived", async () => {
  const controller = new AbortController();
  const request = vi.fn<typeof fetch>(async () => {
    controller.abort();
    return Response.json({ data: [] });
  });

  await expect(
    new CatalogHttpClient(request).get(input({ signal: controller.signal })),
  ).rejects.toMatchObject({ code: "check_timeout" });
});

it("classifies a structured provider error of a failed response", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({ error: { code: "invalid_api_key" } }, { status: 401 }),
  );

  await expect(
    new CatalogHttpClient(request).get(input()),
  ).rejects.toMatchObject({ code: "provider_auth_failed" });
  expect(logging.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: "warn" }),
  );
});

it("classifies a failed response by its status when the body is no JSON", async () => {
  const request = vi.fn<typeof fetch>(
    async () => new Response("<html>", { status: 418 }),
  );

  await expect(
    new CatalogHttpClient(request).get(input()),
  ).rejects.toMatchObject({ code: "provider_request_rejected" });
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "CatalogHttpClient",
    expect.any(SyntaxError),
  );
});

it("does not read an error body beyond the remaining budget", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({ error: { code: "invalid_api_key" } }, { status: 503 }),
  );

  await expect(
    new CatalogHttpClient(request).get(input({ remainingBytes: 4 })),
  ).rejects.toMatchObject({ code: "provider_unavailable" });
});

it("falls back to a bad response when a failure has no classification", async () => {
  vi.mocked(classifyProviderError).mockReturnValueOnce(null);
  const request = vi.fn<typeof fetch>(
    async () => new Response("{}", { status: 500 }),
  );

  await expect(
    new CatalogHttpClient(request).get(input()),
  ).rejects.toMatchObject({ code: "provider_bad_response" });
});

it("refuses a successful page that carries a provider error", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({ error: "listing failed" }),
  );

  await expect(
    new CatalogHttpClient(request).get(input()),
  ).rejects.toMatchObject({ code: "provider_bad_response" });
});

it("refuses a page beyond the remaining byte budget", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({ data: ["x".repeat(100)] }),
  );

  await expect(
    new CatalogHttpClient(request).get(input({ remainingBytes: 50 })),
  ).rejects.toMatchObject({ code: "catalog_limit_exceeded" });
});

it("refuses a response without a body", async () => {
  const request = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 200 }),
  );

  await expect(
    new CatalogHttpClient(request).get(input()),
  ).rejects.toMatchObject({ code: "provider_bad_response" });
});

it("refuses a page that is no JSON", async () => {
  const request = vi.fn<typeof fetch>(async () => new Response("not json"));

  await expect(
    new CatalogHttpClient(request).get(input()),
  ).rejects.toMatchObject({ code: "provider_bad_response" });
});

it("reports a transport failure as an unreachable provider", async () => {
  const request = vi.fn<typeof fetch>(async () => {
    throw new TypeError("fetch failed");
  });

  const failure = new CatalogHttpClient(request).get(input());

  await expect(failure).rejects.toBeInstanceOf(AgentError);
  await expect(failure).rejects.toMatchObject({ code: "provider_unreachable" });
});
