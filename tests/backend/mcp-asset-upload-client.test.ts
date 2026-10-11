import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadAgentAsset } from "../../mcp/src/asset-upload-client";
import { operationFailure } from "../../mcp/src/tools/operation-failure";

const configuration = {
  agentsUrl: new URL("https://pages.invalid/prefix/api/v1/agents"),
  token: "must-not-be-forwarded",
};
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCP binary asset client", () => {
  it("streams directly under a header-only capability with its own budget and deployment prefix", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ apiVersion: "1", result: { assetId: "asset" } }),
      );
    vi.stubGlobal("fetch", fetcher);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const body = new Blob(["synthetic binary bytes"]).stream();
    expect(
      await uploadAgentAsset(configuration, "synthetic-ticket", body),
    ).toMatchObject({ result: { assetId: "asset" } });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://pages.invalid/prefix/api/v1/agent-assets"),
      expect.objectContaining({
        method: "POST",
        body,
        duplex: "half",
        redirect: "error",
        headers: {
          "X-Pages-Upload-Ticket": "synthetic-ticket",
          "Content-Type": "application/octet-stream",
        },
      }),
    );
    expect(timeout).toHaveBeenCalledWith(300_000);
    expect(fetcher.mock.calls[0]?.[1].headers).not.toHaveProperty(
      "Authorization",
    );
  });

  it("reports only public business failures and fixed network, authentication or malformed-response errors", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    fetcher.mockRejectedValueOnce(new Error("private diagnostic"));
    await expect(
      uploadAgentAsset(configuration, "synthetic", new Blob([]).stream()),
    ).rejects.toThrow("Could not upload the Pages asset.");
    fetcher.mockResolvedValueOnce(
      Response.json(
        { apiVersion: "1", error: { code: "PAYLOAD_TOO_LARGE" } },
        { status: 413 },
      ),
    );
    await expect(
      uploadAgentAsset(configuration, "synthetic", new Blob([]).stream()),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    fetcher.mockResolvedValueOnce(
      Response.json({ error: "AUTH_INVALID" }, { status: 401 }),
    );
    await expect(
      uploadAgentAsset(configuration, "synthetic", new Blob([]).stream()),
    ).rejects.toThrow("The Pages asset upload was rejected.");
    fetcher.mockResolvedValueOnce(new Response("invalid JSON"));
    await expect(
      uploadAgentAsset(configuration, "synthetic", new Blob([]).stream()),
    ).rejects.toThrow("The Pages asset upload returned invalid JSON.");
  });

  it.each([
    ["CONFLICT", 409],
    ["FORBIDDEN", 403],
  ] as const)(
    "recognizes only the matching status for %s",
    async (code, status) => {
      expect(
        await operationFailure(
          Response.json({ apiVersion: "1", error: { code } }, { status }),
        ),
      ).toMatchObject({ code });
      expect(
        await operationFailure(
          Response.json({ apiVersion: "1", error: { code } }, { status: 400 }),
        ),
      ).toBeUndefined();
    },
  );
});
