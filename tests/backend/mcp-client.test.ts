import { describe, expect, it, vi } from "vitest";

import { readConfiguration } from "../../mcp/src/configuration";
import { postAgentRequest } from "../../mcp/src/pages-client";

const configuration = readConfiguration({
  PAGES_URL: "https://pages.invalid/company/",
  PAGES_TOKEN: "sentinel-secret",
});
const request = { operation: "unimplemented", parameters: {} };

describe("Pages HTTP adapter", () => {
  it("sends the shared contract with credentials only in the header", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(Response.json({ apiVersion: "1" }));
    vi.stubGlobal("fetch", fetchRequest);
    await expect(postAgentRequest(configuration, request)).resolves.toEqual({
      apiVersion: "1",
    });
    expect(fetchRequest).toHaveBeenCalledWith(
      configuration.agentsUrl,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        body: JSON.stringify(request),
        headers: {
          Authorization: "Bearer sentinel-secret",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("redacts network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("sentinel-secret")),
    );
    await expect(postAgentRequest(configuration, request)).rejects.toThrow(
      "Could not reach the Pages agent API.",
    );
  });

  it.each([
    Response.json({ error: "sentinel-secret" }, { status: 503 }),
    new Response(null, { status: 401 }),
  ])(
    "discards rejected responses without reporting their contents",
    async (response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(postAgentRequest(configuration, request)).rejects.toThrow(
        "The Pages agent API rejected the request.",
      );
    },
  );

  it("redacts malformed response bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("sentinel-secret")),
    );
    await expect(postAgentRequest(configuration, request)).rejects.toThrow(
      "The Pages agent API returned invalid JSON.",
    );
  });

  it("redacts a rejected response whose stream cannot be cancelled", async () => {
    const response = new Response("sentinel-secret", { status: 503 });
    if (!response.body) throw new Error("Expected a response body.");
    vi.spyOn(response.body, "cancel").mockRejectedValue(
      new Error("sentinel-secret"),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(postAgentRequest(configuration, request)).rejects.toThrow(
      "The Pages agent API rejected the request.",
    );
  });
});

describe("MCP import request recovery and timeout", () => {
  it.each([
    ["wiki.import.apply", 30_000],
    ["wiki.import.update", 30_000],
    ["import.structured.apply", 30_000],
    ["wiki.import.plan", 5_000],
  ] as const)(
    "uses the documented budget for %s",
    async (operation, timeout) => {
      const signal = vi.spyOn(AbortSignal, "timeout");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ apiVersion: "1" })),
      );
      await postAgentRequest(configuration, { operation, parameters: {} });
      expect(signal).toHaveBeenCalledExactlyOnceWith(timeout);
    },
  );

  it("repeats the same operation key and package after a lost HTTP response", async () => {
    const input = {
      operation: "wiki.import.apply",
      parameters: {
        operationId: "recoverable-package",
        fingerprint: "a".repeat(64),
        projectId: "alpha",
        parentId: null,
        manifest: { version: "1", index: [], files: [] },
      },
    };
    const response = {
      apiVersion: "1",
      result: {
        runId: "run",
        status: "complete",
        items: [{ pageId: "committed-page", assets: [] }],
      },
    };
    const fetchRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(Response.json(response));
    vi.stubGlobal("fetch", fetchRequest);
    await expect(postAgentRequest(configuration, input)).rejects.toThrow(
      "Could not reach the Pages agent API.",
    );
    expect(await postAgentRequest(configuration, input)).toEqual(response);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    for (const call of fetchRequest.mock.calls)
      expect(call[1]).toMatchObject({ body: JSON.stringify(input) });
  });
});
