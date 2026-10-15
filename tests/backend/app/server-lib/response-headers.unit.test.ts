import { describe, expect, it } from "vitest";

import { getClientAddress } from "@/app/lib/client-address.server";
import { contentDisposition } from "@/app/lib/content-disposition";
import { createSecurityHeaders } from "@/app/lib/security-headers";

import { SYNTHETIC_ORIGIN } from "./request-fixtures";

function requestFrom(forwardedFor: string | null): Request {
  const headers: Record<string, string> = {};

  if (forwardedFor !== null) {
    headers["x-forwarded-for"] = forwardedFor;
  }

  return new Request(SYNTHETIC_ORIGIN, { headers });
}

describe("createSecurityHeaders", () => {
  it("forbids framing, sniffing and cross-origin embedding", () => {
    const headers = createSecurityHeaders();

    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });

  it("restricts the content security policy to the own origin", () => {
    const policy = createSecurityHeaders()["Content-Security-Policy"] ?? "";
    const directives = policy.split("; ");

    expect(directives).toContain("default-src 'self'");
    expect(directives).toContain("object-src 'none'");
    expect(directives).toContain("base-uri 'self'");
    expect(directives).toContain("form-action 'self'");
    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives).toContain("connect-src 'self'");
    expect(policy).not.toContain("*");
  });

  it("leaves HSTS to the proxy and returns a fresh object each time", () => {
    const first = createSecurityHeaders();
    first["X-Frame-Options"] = "ALLOWALL";

    expect(first).not.toHaveProperty("Strict-Transport-Security");
    expect(createSecurityHeaders()["X-Frame-Options"]).toBe("DENY");
  });
});

describe("contentDisposition", () => {
  it("names plain ASCII files in both forms", () => {
    expect(contentDisposition("attachment", "report.pdf")).toBe(
      "attachment; filename=\"report.pdf\"; filename*=UTF-8''report.pdf",
    );
  });

  it("supports inline display", () => {
    expect(contentDisposition("inline", "a.png")).toMatch(/^inline; /u);
  });

  it("keeps umlauts in the encoded name and masks them in the fallback", () => {
    const header = contentDisposition("attachment", "Büro Übersicht.txt");

    expect(header).toContain('filename="B_ro _bersicht.txt"');
    expect(header).toContain("filename*=UTF-8''B%C3%BCro%20%C3%9Cbersicht.txt");
  });

  it("cannot break out of the quoted fallback name", () => {
    const header = contentDisposition("attachment", 'a"; x=y\\b\r\nSet: z');
    const fallback = /filename="([^"]*)"/u.exec(header)?.[1] ?? "";

    expect(fallback).toBe("a_; x=y_b__Set: z");
    expect(header).not.toMatch(/[\r\n]/u);
  });

  it("percent-encodes the characters RFC 5987 reserves", () => {
    const header = contentDisposition("attachment", "it's (1)*.txt");

    expect(header).toContain("filename*=UTF-8''it%27s%20%281%29%2A.txt");
  });
});

describe("getClientAddress", () => {
  it("returns the first forwarded address", () => {
    expect(getClientAddress(requestFrom("203.0.113.7, 10.0.0.1"))).toBe(
      "203.0.113.7",
    );
  });

  it("trims blanks around the address", () => {
    expect(getClientAddress(requestFrom("  203.0.113.7 "))).toBe("203.0.113.7");
  });

  it.each([null, "", "   ", " , 10.0.0.1"])(
    "reports no address for the header %j",
    (header) => {
      expect(getClientAddress(requestFrom(header))).toBeNull();
    },
  );
});
