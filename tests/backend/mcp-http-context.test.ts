import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../mcp/node_modules/@modelcontextprotocol/server/dist/index.mjs",
  () => ({ createMcpHandler: vi.fn() }),
);
vi.mock("../../mcp/src/server", () => ({ createServer: vi.fn() }));
vi.mock("../../mcp/src/verification", () => ({
  readVerifiedIdentity: vi.fn(),
}));

import { createMcpHandler } from "../../mcp/node_modules/@modelcontextprotocol/server/dist/index.mjs";
import { createServer } from "../../mcp/src/server";
import { createProtectedResource } from "../../mcp/src/http-resource";
import { readHttpConfiguration } from "../../mcp/src/http-configuration";

beforeEach(() => {
  vi.mocked(createMcpHandler).mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
  } as never);
});

describe("HTTP per-request identity isolation", () => {
  it("refuses a missing verified context and binds the distinct delegation credential", async () => {
    const configuration = readHttpConfiguration(
      { PAGES_URL: "https://pages.invalid" },
      ["--http", "--resource", "https://mcp.invalid/mcp"],
    );
    const resource = createProtectedResource(configuration);
    const factory = vi.mocked(createMcpHandler).mock.calls[0]?.[0];
    if (!factory) throw new Error("Missing factory");
    factory({ era: "modern" });
    const anonymous = vi.mocked(createServer).mock.calls[0]?.[0];
    if (!anonymous) throw new Error("Missing resolver");
    expect(() => anonymous()).toThrow("Pages authorization failed.");
    factory({
      era: "modern",
      authInfo: {
        token: "distinct-delegation",
        clientId: "user-1",
        scopes: ["mcp:connect"],
      },
    });
    const authenticated = vi.mocked(createServer).mock.calls[1]?.[0];
    if (!authenticated) throw new Error("Missing resolver");
    expect(authenticated()).toEqual({
      agentsUrl: configuration.agentsUrl,
      token: "distinct-delegation",
    });
    await resource.close();
  });
});
