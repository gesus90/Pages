import { describe, expect, it } from "vitest";

import { getClientAddress } from "@/app/lib/client-address.server";

function createRequest(forwardedFor: string | null): Request {
  const headers = new Headers();

  if (forwardedFor !== null) {
    headers.set("X-Forwarded-For", forwardedFor);
  }

  return new Request("http://pages.invalid/login", { headers });
}

describe("getClientAddress", () => {
  it("returns null without a forwarding header", () => {
    expect(getClientAddress(createRequest(null))).toBeNull();
  });

  it("returns the first address of the chain", () => {
    expect(
      getClientAddress(createRequest("203.0.113.7, 10.0.0.1, 10.0.0.2")),
    ).toBe("203.0.113.7");
  });

  it("trims blanks around the address", () => {
    expect(getClientAddress(createRequest("  203.0.113.7  "))).toBe(
      "203.0.113.7",
    );
  });

  it("treats an empty header as unknown", () => {
    expect(getClientAddress(createRequest(""))).toBeNull();
    expect(getClientAddress(createRequest(" , 10.0.0.1"))).toBeNull();
  });
});
