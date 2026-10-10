import { request } from "node:http";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
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
      host: "127.0.0.1",
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

const ownAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry !== undefined);
const hasIpv6Loopback = ownAddresses.some((entry) => entry.address === "::1");
const externalAddress = ownAddresses.find(
  (entry) => entry.family === "IPv4" && !entry.internal,
)?.address;

function listenerConfiguration(
  host: string,
): Parameters<typeof startHttpServer>[0] {
  return {
    issuer: "https://pages.invalid",
    agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
    resource: new URL("https://mcp.invalid/mcp"),
    host,
    port: 0,
  };
}

function listenerPort(
  server: Awaited<ReturnType<typeof startHttpServer>>,
): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP listener");
  }
  return address.port;
}

function connectionOutcome(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      resolve(error.code ?? "error");
    });
  });
}

describe("loopback listener address", () => {
  it("honors Connection: close even when the SDK requests keep-alive", async () => {
    fetchResource.mockResolvedValue(
      Response.json({}, { headers: { Connection: "keep-alive" } }),
    );
    const server = await startHttpServer(listenerConfiguration("127.0.0.1"));
    try {
      const response = await new Promise<{
        status: number | undefined;
        connection: string | undefined;
      }>((resolve, reject) => {
        const outgoing = request(
          {
            host: "127.0.0.1",
            port: listenerPort(server),
            path: "/mcp",
            headers: { Host: "mcp.invalid", Connection: "close" },
          },
          (incoming) => {
            incoming.resume();
            resolve({
              status: incoming.statusCode,
              connection: incoming.headers.connection,
            });
          },
        );
        outgoing.on("error", reject);
        outgoing.end();
      });
      expect(response.status).toBe(200);
      expect(response.connection).toBe("close");
    } finally {
      await promisify(server.close.bind(server))();
    }
  });

  it("binds only the configured loopback address", async () => {
    const server = await startHttpServer(listenerConfiguration("127.0.0.1"));
    try {
      const address = server.address();
      expect(address).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
      expect(await connectionOutcome("127.0.0.1", listenerPort(server))).toBe(
        "connected",
      );
    } finally {
      await promisify(server.close.bind(server))();
    }
  });

  it.runIf(hasIpv6Loopback)("binds the IPv6 loopback address ::1", async () => {
    const server = await startHttpServer(listenerConfiguration("::1"));
    try {
      expect(server.address()).toMatchObject({
        address: "::1",
        family: "IPv6",
      });
      expect(await connectionOutcome("::1", listenerPort(server))).toBe(
        "connected",
      );
    } finally {
      await promisify(server.close.bind(server))();
    }
  });

  it("resolves localhost to a loopback address", async () => {
    const server = await startHttpServer(listenerConfiguration("localhost"));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected a TCP listener");
      }
      expect(["127.0.0.1", "::1"]).toContain(address.address);
    } finally {
      await promisify(server.close.bind(server))();
    }
  });

  it.runIf(externalAddress !== undefined)(
    "refuses a connection through a non-loopback address of this machine",
    async () => {
      const server = await startHttpServer(listenerConfiguration("127.0.0.1"));
      try {
        expect(
          await connectionOutcome(externalAddress ?? "", listenerPort(server)),
        ).toBe("ECONNREFUSED");
      } finally {
        await promisify(server.close.bind(server))();
      }
    },
  );
});
