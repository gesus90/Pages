import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadAgentAsset } from "../../src/asset-upload-client.ts";
import { PagesOperationFailure } from "../../src/tools/operation-failure.ts";

const CONFIGURATION = {
  agentsUrl: new URL("https://pages.example/team/api/v1/agents"),
  token: "never-sent",
};

const fetchMock = vi.fn<typeof fetch>();

function bytes(): ReadableStream<Uint8Array> {
  return new Blob(["file bytes"]).stream();
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("uploadAgentAsset", () => {
  it("streams the bytes with only the upload ticket", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ apiVersion: "1", result: { assetId: "a" } }),
      ),
    );
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const body = bytes();
    await expect(
      uploadAgentAsset(CONFIGURATION, "ticket-1", body),
    ).resolves.toEqual({ apiVersion: "1", result: { assetId: "a" } });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://pages.example/team/api/v1/agent-assets");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "X-Pages-Upload-Ticket": "ticket-1",
        "Content-Type": "application/octet-stream",
      },
      body,
      duplex: "half",
      redirect: "error",
    });
    expect(JSON.stringify(init?.headers)).not.toContain("never-sent");
    expect(timeout).toHaveBeenCalledWith(300_000);
  });

  it("hides network failures behind a fixed message", async () => {
    fetchMock.mockRejectedValue(new TypeError("socket hang up"));
    await expect(
      uploadAgentAsset(CONFIGURATION, "ticket", bytes()),
    ).rejects.toThrow("Could not upload the Pages asset.");
  });

  it("returns whitelisted business failures", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          apiVersion: "1",
          error: {
            code: "PAYLOAD_TOO_LARGE",
            details: { constraint: "requestBytes", limit: 10 },
          },
        }),
        { status: 413 },
      ),
    );
    const upload = uploadAgentAsset(CONFIGURATION, "ticket", bytes());
    await expect(upload).rejects.toBeInstanceOf(PagesOperationFailure);
    await expect(upload).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      details: { constraint: "requestBytes", limit: 10 },
    });
  });

  it("hides other rejections", async () => {
    fetchMock.mockResolvedValue(new Response("expired", { status: 401 }));
    await expect(
      uploadAgentAsset(CONFIGURATION, "ticket", bytes()),
    ).rejects.toThrow("The Pages asset upload was rejected.");
  });

  it("reports invalid JSON with a fixed message", async () => {
    fetchMock.mockResolvedValue(new Response("<html>"));
    await expect(
      uploadAgentAsset(CONFIGURATION, "ticket", bytes()),
    ).rejects.toThrow("The Pages asset upload returned invalid JSON.");
  });
});
