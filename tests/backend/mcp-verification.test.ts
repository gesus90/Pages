import { beforeEach, describe, expect, it, vi } from "vitest";

import { readVerifiedIdentity, verifyPages } from "../../mcp/src/verification";
import { readHttpConfiguration } from "../../mcp/src/http-configuration";
import { createProtectedResource } from "../../mcp/src/http-resource";
import { startHttpServer } from "../../mcp/src/http-server";

const identity = { userId: "user-1", isAdmin: false, permissions: ["write"] };
const configuration = readHttpConfiguration(
  { PAGES_URL: "https://pages.invalid" },
  ["--http", "--resource", "https://mcp.invalid/mcp"],
);
const credential = "a".repeat(43);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("fresh MCP verification", () => {
  it("validates a successful Pages envelope and rejects all other shapes", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ apiVersion: "1", identity, tools: [] }),
    );
    expect(
      await verifyPages({
        agentsUrl: configuration.agentsUrl,
        token: credential,
      }),
    ).toEqual(identity);
    for (const response of [
      null,
      3,
      {},
      { apiVersion: "wrong" },
      { apiVersion: "1", tools: null },
      { apiVersion: "1", tools: ["business"] },
      { apiVersion: "1", tools: [] },
    ]) {
      vi.mocked(fetch).mockResolvedValue(Response.json(response));
      await expect(
        verifyPages({ agentsUrl: configuration.agentsUrl, token: credential }),
      ).rejects.toThrow("Pages verification failed.");
    }
    for (const invalid of [
      null,
      1,
      {},
      { ...identity, userId: 1 },
      { ...identity, userId: "" },
      { ...identity, isAdmin: 1 },
      { ...identity, permissions: 1 },
      { ...identity, permissions: [1] },
    ])
      expect(() => readVerifiedIdentity(invalid)).toThrow(
        "Pages verification failed.",
      );
  });
  it("validates HTTP options, supplies no personal token, and retains secure URLs", () => {
    expect(configuration.port).toBe(8998);
    expect(
      readHttpConfiguration(
        { PAGES_URL: "http://127.0.0.1:3000", PAGES_TOKEN: "ignored" },
        ["--http", "--resource", "http://127.0.0.1:8998/mcp", "--port", "8998"],
      ).issuer,
    ).toBe("http://127.0.0.1:3000");
    for (const argumentsList of [
      [],
      ["--http"],
      ["bad", "--resource", "https://mcp.invalid/mcp"],
      ["--http", "bad", "https://mcp.invalid/mcp"],
      ["--http", "--resource", "https://mcp.invalid/mcp", "bad", "1234"],
      ["--http", "--resource", "https://mcp.invalid/wrong"],
      ["--http", "--resource", "https://mcp.invalid/mcp", "--port", "0"],
      ["--http", "--resource", "https://mcp.invalid/mcp", "--port", "1.5"],
      ["--http", "--resource", "https://mcp.invalid/mcp", "--port", "65536"],
    ]) {
      expect(() =>
        readHttpConfiguration(
          { PAGES_URL: "https://pages.invalid" },
          argumentsList,
        ),
      ).toThrow();
    }
    expect(() =>
      readHttpConfiguration({ PAGES_URL: "https://pages.invalid/prefix" }, [
        "--http",
        "--resource",
        "https://mcp.invalid/mcp",
      ]),
    ).toThrow();
  });
});

describe("HTTP protected resource", () => {
  it("advertises resource metadata, challenges anonymous requests and validates host/origin/query", async () => {
    const resource = createProtectedResource(configuration);
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const response = await resource.fetch(
        new Request(`https://mcp.invalid${path}`),
      );
      expect(await response.json()).toMatchObject({
        resource: configuration.resource.href,
        authorization_servers: [configuration.issuer],
        scopes_supported: ["mcp:connect"],
      });
    }
    expect(
      (await resource.fetch(new Request("https://mcp.invalid/unknown"))).status,
    ).toBe(404);
    const response = await resource.fetch(new Request(configuration.resource));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'scope="mcp:connect"',
    );
    for (const request of [
      new Request("https://evil.invalid/mcp"),
      new Request("https://mcp.invalid/mcp?access_token=sentinel-secret"),
      new Request(configuration.resource, {
        headers: { Origin: "https://evil.invalid" },
      }),
    ])
      expect((await resource.fetch(request)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    await resource.close();
  });
  it("delegates each request and sends only the distinct API credential to Pages", async () => {
    const resource = createProtectedResource(configuration);
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      if (String(url).endsWith("/oauth/delegate")) {
        expect(options?.headers).not.toHaveProperty("Authorization");
        expect(JSON.parse(String(options?.body))).toEqual({
          subject_token: credential,
          resource: configuration.resource.href,
        });
        return Response.json({
          identity,
          delegationToken: "b".repeat(43),
          audience: configuration.agentsUrl.href,
          expiresAt: Date.now() + 50_000,
        });
      }
      expect(options?.headers).toHaveProperty(
        "Authorization",
        `Bearer ${"b".repeat(43)}`,
      );
      return Response.json({ apiVersion: "1", identity, tools: [] });
    });
    const makeRequest = () =>
      new Request(configuration.resource, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/list",
          Origin: configuration.resource.origin,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      });
    const response = await resource.fetch(makeRequest());
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.text()).not.toContain(credential);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    expect((await resource.fetch(makeRequest())).status).toBe(401);
    await resource.close();
  });
  it("fails closed without leaking credentials on network, issuer, audience or response failures", async () => {
    const resource = createProtectedResource(configuration);
    const request = () =>
      new Request(configuration.resource, {
        headers: { Authorization: `Bearer ${credential}` },
      });
    for (const result of [
      null,
      1,
      {},
      { identity },
      { identity, delegationToken: 1 },
      { identity, delegationToken: "bad" },
      { identity, delegationToken: credential, audience: "wrong" },
      {
        identity,
        delegationToken: credential,
        audience: configuration.agentsUrl.href,
        expiresAt: "bad",
      },
      {
        identity,
        delegationToken: credential,
        audience: configuration.agentsUrl.href,
        expiresAt: 0,
      },
      {
        identity,
        delegationToken: credential,
        audience: configuration.agentsUrl.href,
        expiresAt: Date.now() + 100_000,
      },
    ]) {
      vi.mocked(fetch).mockResolvedValue(Response.json(result));
      const response = await resource.fetch(request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(credential);
    }
    vi.mocked(fetch).mockRejectedValue("unexpected");
    expect((await resource.fetch(request())).status).toBe(503);
    vi.mocked(fetch).mockRejectedValue(new Error(credential));
    expect((await resource.fetch(request())).status).toBe(503);
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    expect((await resource.fetch(request())).status).toBe(503);
    await resource.close();
  });
  it("mounts a loopback-only listener and rejects invalid host and oversized bodies", async () => {
    // Use the real Node HTTP client; the global fetch remains a fake for Pages traffic.
    const { request: nodeRequest } = await import("node:http");
    const { promisify } = await import("node:util");
    const server = await startHttpServer({ ...configuration, port: 0 });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected TCP listener");
    expect(address.address).toBe("127.0.0.1");
    const send = (host: string, path: string, body = "") =>
      new Promise<number>((resolve, reject) => {
        const outgoing = nodeRequest(
          {
            host: "127.0.0.1",
            port: address.port,
            path,
            method: "POST",
            headers: { Host: host },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        outgoing.on("error", reject);
        outgoing.end(body);
      });
    expect(await send("evil.invalid", "/mcp")).toBe(403);
    expect(await send("mcp.invalid", "/mcp", "x".repeat(70_000))).toBe(413);
    expect(await send("mcp.invalid", "/mcp")).toBe(401);
    expect(await send("mcp.invalid", "/mcp", "body")).toBe(401);
    await promisify(server.close.bind(server))();
  });
});
