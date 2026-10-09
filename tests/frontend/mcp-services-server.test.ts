import { describe, expect, it, vi } from "vitest";

import { createMcpServices } from "@/app/lib/mcp-services.server";
import { authorizationFixture } from "../helpers/mcp-authorization";

describe("MCP service wiring", () => {
  it("keeps OAuth configuration lazy while personal-token verification remains available", async () => {
    const fixture = await authorizationFixture();
    try {
      vi.stubEnv("PAGES_OAUTH_ISSUER", "");
      vi.stubEnv("PAGES_MCP_RESOURCE", "");
      const services = createMcpServices(
        fixture.database,
        fixture.users,
        fixture.administration,
      );
      const created = await services.personalAgentTokenService.create(
        "user-1",
        "local",
        null,
      );
      await expect(
        services.pagesAgentApiService.handle(created.token, {
          operation: "verify",
        }),
      ).resolves.toMatchObject({ tools: [] });
      await expect(
        services.oauthConsentService.begin(new URLSearchParams()),
      ).rejects.toMatchObject({ status: 503 });
      vi.stubEnv("PAGES_OAUTH_ISSUER", "https://pages.invalid");
      vi.stubEnv("PAGES_MCP_RESOURCE", "https://mcp.invalid/mcp");
      await expect(
        services.oauthConsentService.begin(new URLSearchParams()),
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      await fixture.database.close();
    }
  });
});
