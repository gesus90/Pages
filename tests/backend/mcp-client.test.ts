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
