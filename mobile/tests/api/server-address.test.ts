import { parseServerAddress } from "@/api/server-address";

describe("parseServerAddress", () => {
  it("normalizes an https address to its origin without a trailing slash", () => {
    expect(parseServerAddress("  https://pages.example.com/  ")).toEqual({
      ok: true,
      url: "https://pages.example.com",
      host: "pages.example.com",
    });
  });

  it("adds https when the scheme is left out", () => {
    expect(parseServerAddress("pages.example.com")).toEqual({
      ok: true,
      url: "https://pages.example.com",
      host: "pages.example.com",
    });
  });

  it("keeps a path prefix and a port", () => {
    expect(parseServerAddress("https://example.com:8443/pages//")).toEqual({
      ok: true,
      url: "https://example.com:8443/pages",
      host: "example.com:8443",
    });
  });

  it("rejects an empty address", () => {
    expect(parseServerAddress("   ")).toEqual({ ok: false, problem: "empty" });
  });

  it("rejects plain http unless the build allows it", () => {
    expect(parseServerAddress("http://pages.example.com")).toEqual({
      ok: false,
      problem: "insecure",
    });
    expect(
      parseServerAddress("http://pages.example.com", {
        allowInsecureHttp: true,
      }),
    ).toMatchObject({ ok: true, url: "http://pages.example.com" });
  });

  it("rejects other schemes and unparsable input", () => {
    expect(parseServerAddress("ftp://pages.example.com")).toEqual({
      ok: false,
      problem: "invalid",
    });
    expect(parseServerAddress("https://")).toEqual({
      ok: false,
      problem: "invalid",
    });
  });

  it("rejects credentials, a query and a fragment in the address", () => {
    expect(parseServerAddress("https://user:secret@example.com")).toEqual({
      ok: false,
      problem: "credentials",
    });
    expect(parseServerAddress("https://example.com/?token=1")).toEqual({
      ok: false,
      problem: "extras",
    });
    expect(parseServerAddress("https://example.com/#top")).toEqual({
      ok: false,
      problem: "extras",
    });
  });
});
