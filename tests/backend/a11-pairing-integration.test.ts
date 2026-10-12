import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { CredentialStore } from "../../mcp/src/credential-store";
import { runCredentialCommand } from "../../mcp/src/credential-command";
import { readStdioConfiguration } from "../../mcp/src/stdio-configuration";
import { verifyPages } from "../../mcp/src/verification";
import { connectMcpServer } from "../helpers/mcp-server";
import { pairingFixture, pairingAddress } from "../helpers/a11-pairing";
import { browser } from "../helpers/mcp-authorization";

let fixture: Awaited<ReturnType<typeof pairingFixture>>;
function isRequest(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T23:00:00Z"));
  fixture = await pairingFixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (address: URL, init: RequestInit) => {
      expect(address.origin).toBe("http://192.168.1.7:4567");
      expect(init.redirect).toBe("error");
      const request = new Request(address, init);
      const input: unknown = await request.json();
      if (!isRequest(input)) throw new Error("Invalid fixture envelope");
      try {
        if (address.pathname === "/api/v1/pairing")
          return Response.json(
            await fixture.pairing.begin(input, pairingAddress),
            { status: 201 },
          );
        if (address.pathname === "/api/v1/pairing/token")
          return Response.json(await fixture.pairing.exchange(input));
        if (address.pathname === "/api/v1/agents")
          return Response.json(
            await fixture.api.handle(
              request.headers.get("Authorization")?.slice(7) ?? "",
              input,
            ),
          );
        throw new Error("Unexpected isolated endpoint");
      } catch (error: unknown) {
        if (error instanceof McpAuthorizationError)
          return Response.json({ error: error.code }, { status: error.status });
        throw error;
      }
    }),
  );
});
afterEach(async () => {
  await fixture.close();
  vi.useRealTimers();
});

describe("A11.2 CLI, credential file, verification and MCP handlers together", () => {
  it("pairs, starts using only PAGES_URL, lists project names, rotates on request and fails immediately after revocation", async () => {
    const environment = {
      PAGES_URL: "http://192.168.1.7:4567",
      XDG_CONFIG_HOME: fixture.directory,
      LANG: "de",
    };
    const output: string[] = [];
    expect(
      await runCredentialCommand(["pair", "--no-browser"], environment, {
        write: (message) => output.push(message),
        wait: async (milliseconds) => {
          vi.setSystemTime(Date.now() + milliseconds);
        },
        openBrowser: async (link) => {
          expect(link.searchParams.size).toBe(1);
          const view = await fixture.pairing.view(
            link.searchParams.get("code"),
            browser,
            pairingAddress,
          );
          await fixture.pairing.decide(
            {
              code: view.code,
              csrf: view.csrf,
              decision: "approve",
              name: "Isolated client",
              validityDays: 30,
              confirmMatch: true,
            },
            browser,
          );
          return false;
        },
      }),
    ).toBe(0);
    const store = new CredentialStore(environment);
    const credential = await store.get(new URL(environment.PAGES_URL));
    expect(credential).not.toBeNull();
    if (!credential) throw new Error("No isolated credential");
    expect(output.join(" ")).toContain("Verbunden als");
    expect(output.join(" ")).not.toContain(credential.token);
    const configuration = await readStdioConfiguration(environment);
    const transport = await connectMcpServer(() => configuration);
    try {
      expect(
        await transport.request("tools/call", {
          name: "list_project_names",
          arguments: {},
        }),
      ).toMatchObject({ result: { content: [{ type: "text", text: "[]" }] } });
      await fixture.personal.requestRotation(
        browser.userId,
        credential.tokenId,
      );
      await verifyPages(configuration);
      const replacement = await store.get(new URL(environment.PAGES_URL));
      expect(replacement?.tokenId).toBe(credential.tokenId);
      expect(replacement?.expiresAt).toBe(credential.expiresAt);
      expect(replacement?.token).not.toBe(credential.token);
      await expect(
        fixture.personal.verify(credential.token),
      ).rejects.toMatchObject({ code: "invalid_token" });
      await fixture.personal.revoke(browser.userId, credential.tokenId);
      const failed = await transport.request("tools/call", {
        name: "list_project_names",
        arguments: {},
      });
      expect(failed).toMatchObject({
        error: { code: -32603, message: expect.stringContaining("pair") },
      });
      expect(await store.get(new URL(environment.PAGES_URL))).toBeNull();
      expect(JSON.stringify(transport.messages)).not.toContain(
        credential.token,
      );
    } finally {
      await transport.server.close();
    }
  });
});
