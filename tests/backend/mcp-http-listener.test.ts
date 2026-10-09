import { request } from "node:http";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../mcp/src/http-resource", () => ({
  createProtectedResource: vi.fn(),
}));
import { createProtectedResource } from "../../mcp/src/http-resource";
import { startHttpServer } from "../../mcp/src/http-server";

const fetchResource = vi.fn();
const closeResource = vi.fn();
beforeEach(() => {
  vi.mocked(createProtectedResource).mockReturnValue({
    fetch: fetchResource,
    close: closeResource,
  });
  fetchResource.mockResolvedValue(new Response(null, { status: 200 }));
  closeResource.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loopback HTTP listener failures", () => {
  it("rejects a second listener and redacts request, listener and shutdown errors", async () => {
    const configuration = {
      issuer: "https://pages.invalid",
      agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
      resource: new URL("https://mcp.invalid/mcp"),
      port: 0,
    };
    const server = await startHttpServer(configuration);
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing port");
      await expect(
        startHttpServer({ ...configuration, port: address.port }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
      server.emit("error", new Error("sentinel-secret"));
      expect(console.error).toHaveBeenCalledWith(
        "[pages-mcp] HTTP server failed.",
      );
      fetchResource.mockRejectedValue(new Error("sentinel-secret"));
      const status = await new Promise<number>((resolve, reject) => {
        const outgoing = request(
          {
            host: "127.0.0.1",
            port: address.port,
            method: "POST",
            path: "/mcp",
            headers: {
              Host: "mcp.invalid",
              "Set-Cookie": ["first=1", "second=2"],
            },
          },
          (incoming) => {
            incoming.resume();
            resolve(incoming.statusCode ?? 0);
          },
        );
        outgoing.on("error", reject);
        outgoing.end();
      });
      expect(status).toBe(503);
      closeResource.mockRejectedValue(new Error("sentinel-secret"));
    } finally {
      await promisify(server.close.bind(server))();
    }
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "[pages-mcp] HTTP shutdown failed.",
      ),
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "sentinel-secret",
    );
  });
});
