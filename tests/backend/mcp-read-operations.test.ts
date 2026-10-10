import { describe, expect, it, vi } from "vitest";

import { readOperation } from "../../mcp/src/tools/read-operation";
import { operationFailure } from "../../mcp/src/tools/operation-failure";

const configuration = {
  agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
  token: "sentinel-secret",
};

describe("MCP read responses and safe business failures", () => {
  it("returns the result of the named operation using the verified credential only in its header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          apiVersion: "1",
          result: { id: "alpha", name: "Alpha" },
        }),
      ),
    );
    expect(
      await readOperation(configuration, "projects.resolve", { name: "Alpha" }),
    ).toEqual({ id: "alpha", name: "Alpha" });
    expect(fetch).toHaveBeenCalledWith(
      configuration.agentsUrl,
      expect.objectContaining({
        body: JSON.stringify({
          operation: "projects.resolve",
          parameters: { name: "Alpha" },
        }),
      }),
    );
  });

  it.each([
    null,
    1,
    {},
    { apiVersion: "2", result: {} },
    { apiVersion: "1", result: null },
    { apiVersion: "1", result: [] },
    { apiVersion: "1", result: 1 },
  ])("rejects invalid success envelopes (%j)", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response)));
    await expect(
      readOperation(configuration, "wiki.tree.read", {}),
    ).rejects.toThrow("Pages read failed.");
  });

  it.each([
    ["NOT_FOUND", 404],
    ["INVALID_REQUEST", 400],
    ["PAYLOAD_TOO_LARGE", 413],
  ] as const)("returns only a stable code for %s", async (code, status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            apiVersion: "1",
            error: {
              code,
              message: "sentinel-secret",
              details: "sentinel-secret",
            },
          },
          { status },
        ),
      ),
    );
    await expect(
      readOperation(configuration, "wiki.page.read", { pageId: "missing" }),
    ).rejects.toMatchObject({
      code,
      message: "The agent API request was rejected.",
      details: undefined,
    });
  });

  it("offers only projected visible candidate IDs and names on ambiguity", async () => {
    const failure = await operationFailure(
      Response.json(
        {
          apiVersion: "1",
          error: {
            code: "AMBIGUOUS",
            message: "sentinel-secret",
            details: {
              candidates: [
                { id: "a", name: "Alpha", privateExtra: "sentinel-secret" },
              ],
              truncated: false,
              extra: "sentinel-secret",
            },
          },
        },
        { status: 409 },
      ),
    );
    expect(failure).toMatchObject({
      code: "AMBIGUOUS",
      details: { candidates: [{ id: "a", name: "Alpha" }], truncated: false },
    });
    expect(JSON.stringify(failure)).not.toContain("sentinel-secret");
  });

  it.each([
    null,
    1,
    {},
    { apiVersion: "1", error: null },
    { apiVersion: "1", error: 1 },
    { apiVersion: "2", error: {} },
    { apiVersion: "1", error: { code: "AUTH_INVALID" } },
    { apiVersion: "1", error: { code: "NOT_FOUND" } },
  ])(
    "ignores unknown, malformed or status-mismatched failures (%j)",
    async (input) => {
      expect(
        await operationFailure(Response.json(input, { status: 401 })),
      ).toBeUndefined();
    },
  );

  it.each([
    undefined,
    null,
    1,
    {},
    { candidates: null, truncated: false },
    { candidates: Array(101).fill({ id: "a", name: "A" }), truncated: true },
    { candidates: [], truncated: 1 },
    { candidates: [null], truncated: false },
    { candidates: [1], truncated: false },
    { candidates: [{ id: 1, name: "A" }], truncated: false },
    { candidates: [{ id: "a", name: 1 }], truncated: false },
  ])("rejects invalid ambiguity details (%j)", async (details) => {
    expect(
      await operationFailure(
        Response.json(
          { apiVersion: "1", error: { code: "AMBIGUOUS", details } },
          { status: 409 },
        ),
      ),
    ).toBeUndefined();
  });

  it("redacts rejected authentication and non-JSON errors on a business call", async () => {
    expect(
      await operationFailure(new Response("sentinel-secret", { status: 500 })),
    ).toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("sentinel-secret", { status: 401 })),
    );
    await expect(
      readOperation(configuration, "wiki.search", { text: "needle" }),
    ).rejects.toThrow("The Pages agent API rejected the request.");
  });
});
