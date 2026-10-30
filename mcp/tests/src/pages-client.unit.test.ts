import { beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialStoreError } from "../../src/credential-error.ts";
import { postAgentRequest } from "../../src/pages-client.ts";
import { PagesTransportError } from "../../src/pages-transport-error.ts";
import { PagesOperationError } from "../../src/tools/operation-failure.ts";

import type { PagesConfiguration } from "../../src/configuration.ts";

const AGENTS_URL = new URL("https://pages.example/team/api/v1/agents");
const REQUEST = { operation: "projects.read", parameters: { projectId: "p1" } };

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function requestInit(call: number): RequestInit | undefined {
  return fetchMock.mock.calls[call]?.[1];
}

function pairedConfiguration(
  refresh: (invalidToken: string) => Promise<string>,
): PagesConfiguration {
  return {
    agentsUrl: AGENTS_URL,
    token: "old-token",
    credentials: { refresh, rotate: vi.fn() },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("postAgentRequest success", () => {
  it("posts the JSON envelope with the Bearer credential and no redirects", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ apiVersion: "1", result: {} }),
    );
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await expect(
      postAgentRequest({ agentsUrl: AGENTS_URL, token: "secret" }, REQUEST),
    ).resolves.toEqual({ apiVersion: "1", result: {} });
    expect(fetchMock).toHaveBeenCalledWith(AGENTS_URL, expect.anything());
    const init = requestInit(0);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.body).toBe(JSON.stringify(REQUEST));
    expect(init?.headers).toEqual({
      Authorization: "Bearer secret",
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(timeout).toHaveBeenCalledWith(5_000);
    for (const operation of ["plans.control.read", "workspaces.read"]) {
      await postAgentRequest(
        { agentsUrl: AGENTS_URL, token: "secret" },
        { operation, parameters: {} },
      );
      expect(timeout).toHaveBeenLastCalledWith(60_000);
    }
  });

  it.each([
    "wiki.import.apply",
    "wiki.import.update",
    "import.structured.apply",
  ])("gives %s a thirty-second budget", async (operation) => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await postAgentRequest(
      { agentsUrl: AGENTS_URL, token: "secret" },
      { operation, parameters: {} },
    );
    expect(timeout).toHaveBeenCalledWith(30_000);
  });

  it("reports invalid JSON with a fixed message", async () => {
    fetchMock.mockResolvedValue(new Response("not json"));
    await expect(
      postAgentRequest({ agentsUrl: AGENTS_URL, token: "secret" }, REQUEST),
    ).rejects.toThrow("The Pages agent API returned invalid JSON.");
  });

  it("hides network failures behind a fixed message", async () => {
    fetchMock.mockRejectedValue(new TypeError("connect ECONNREFUSED secret"));
    const request = postAgentRequest(
      { agentsUrl: AGENTS_URL, token: "secret" },
      REQUEST,
    );
    await expect(request).rejects.toBeInstanceOf(PagesTransportError);
    await expect(request).rejects.toThrow(
      "Could not reach the Pages agent API.",
    );
  });
});

describe("postAgentRequest rejected credentials", () => {
  it("retries once with the refreshed paired credential", async () => {
    const refresh = vi.fn(async () => "new-token");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ apiVersion: "1" }));
    await expect(
      postAgentRequest(pairedConfiguration(refresh), REQUEST),
    ).resolves.toEqual({ apiVersion: "1" });
    expect(refresh).toHaveBeenCalledWith("old-token");
    expect(requestInit(1)?.headers).toMatchObject({
      Authorization: "Bearer new-token",
    });
  });

  it("asks for pairing again when the refreshed credential is rejected too", async () => {
    const refresh = vi.fn(async () => "new-token");
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({}, 401));
    const request = postAgentRequest(pairedConfiguration(refresh), REQUEST);
    await expect(request).rejects.toBeInstanceOf(CredentialStoreError);
    await expect(request).rejects.toThrow(
      "The paired credential is no longer valid. Run pages-mcp pair --url <Pages instance> again.",
    );
    expect(refresh).toHaveBeenNthCalledWith(2, "new-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("passes a failed refresh through", async () => {
    const refresh = vi.fn(async () => {
      throw new CredentialStoreError("removed");
    });
    fetchMock.mockResolvedValue(jsonResponse({}, 401));
    await expect(
      postAgentRequest(pairedConfiguration(refresh), REQUEST),
    ).rejects.toThrow("removed");
  });

  it("does not refresh an explicit environment credential", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));
    await expect(
      postAgentRequest({ agentsUrl: AGENTS_URL, token: "secret" }, REQUEST),
    ).rejects.toThrow("The Pages agent API rejected the request.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("postAgentRequest rejected requests", () => {
  const configuration = { agentsUrl: AGENTS_URL, token: "secret" };

  it("returns whitelisted business failures when asked for them", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ apiVersion: "1", error: { code: "NOT_FOUND" } }, 404),
    );
    const request = postAgentRequest(configuration, REQUEST, {
      businessErrors: true,
    });
    await expect(request).rejects.toBeInstanceOf(PagesOperationError);
    await expect(request).rejects.toThrow("Not found or no access.");
  });

  it("hides unknown business failures", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ apiVersion: "1", error: { code: "INTERNAL" } }, 500),
    );
    await expect(
      postAgentRequest(configuration, REQUEST, { businessErrors: true }),
    ).rejects.toThrow("The Pages agent API rejected the request.");
  });

  it("discards the body of a rejected request without business errors", async () => {
    const response = jsonResponse({ secret: "detail" }, 500);
    const body = response.body;
    if (!body) throw new Error("The test response needs a body.");
    const cancel = vi.spyOn(body, "cancel");
    fetchMock.mockResolvedValue(response);
    await expect(postAgentRequest(configuration, REQUEST)).rejects.toThrow(
      "The Pages agent API rejected the request.",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a bodiless response", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(postAgentRequest(configuration, REQUEST)).rejects.toThrow(
      "The Pages agent API rejected the request.",
    );
  });

  it("keeps the fixed message when discarding the body fails", async () => {
    const response = new Response(null, { status: 500 });
    const cancel = vi.fn(async () => {
      throw new Error("stream broken");
    });
    Object.defineProperty(response, "body", { value: { cancel } });
    fetchMock.mockResolvedValue(response);
    await expect(postAgentRequest(configuration, REQUEST)).rejects.toThrow(
      "The Pages agent API rejected the request.",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});
