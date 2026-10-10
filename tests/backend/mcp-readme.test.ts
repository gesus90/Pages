import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const README = readFileSync(
  fileURLToPath(new URL("../../mcp/README.md", import.meta.url)),
  "utf8",
);
const LOOPBACK_HOSTS = ["127.0.0.1", "::1", "localhost"];

describe("MCP README remote operation", () => {
  it("documents a loopback listener behind an HTTPS reverse proxy as the only remote path", () => {
    expect(README).toContain(
      "### Remote operation behind an HTTPS reverse proxy",
    );
    expect(README).toContain("TLS ends at a trusted reverse proxy");
    expect(README).toContain(
      "Do not publish the listener on a non-loopback address",
    );
    expect(README).toContain("`/.well-known/oauth-protected-resource`");
    expect(README).toContain("proxy_set_header Host $http_host;");
    expect(README).toContain("proxy_pass http://127.0.0.1:8998;");
  });

  it("names only loopback values for the --host option", () => {
    const hostValues = [...README.matchAll(/--host\s+([^\s`,;)]+)/g)].map(
      (match) => match[1],
    );
    expect(hostValues.length).toBeGreaterThan(0);
    for (const value of hostValues) {
      const alternatives = value.split("|");
      expect(
        alternatives.every((entry) => LOOPBACK_HOSTS.includes(entry)),
        value,
      ).toBe(true);
    }
  });

  it("does not recommend plain HTTP outside loopback or tokens in URLs", () => {
    expect(README).not.toMatch(/listen\s+0\.0\.0\.0/);
    expect(README).not.toMatch(
      /http:\/\/(?!127\.0\.0\.1|localhost|\[::1\])[a-z0-9.-]+\/mcp/i,
    );
    expect(README).toContain("never put tokens into URLs or logs");
  });

  it("states the release process without a bot commit or npm package", () => {
    expect(README).toContain(
      "nothing is committed to `main`, and no npm package is published",
    );
    expect(README).toContain("mcp-vMAJOR.MINOR.PATCH");
  });
});
