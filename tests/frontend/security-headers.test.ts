import { describe, expect, it } from "vitest";

import { createSecurityHeaders } from "@/app/lib/security-headers";

describe("createSecurityHeaders", () => {
  it("forbids framing, sniffing and unneeded browser features", () => {
    const headers = createSecurityHeaders();

    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });

  it("restricts content to the own origin", () => {
    const policy = createSecurityHeaders()["Content-Security-Policy"] ?? "";
    const directives = policy.split("; ");

    expect(directives).toContain("default-src 'self'");
    expect(directives).toContain("object-src 'none'");
    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives).toContain("form-action 'self'");
    expect(directives).toContain("base-uri 'self'");
    expect(policy).not.toContain("*");
  });

  it("does not send Strict-Transport-Security without TLS knowledge", () => {
    expect(createSecurityHeaders()).not.toHaveProperty(
      "Strict-Transport-Security",
    );
  });
});
