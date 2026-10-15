import { describe, expect, it } from "vitest";

import { parseUserAgent } from "@/backend/auth/UserAgent";

describe("parseUserAgent", () => {
  it.each([
    [
      "Chrome on Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Chrome 126",
      "Windows",
    ],
    [
      "Edge on Windows",
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.81",
      "Edge 126",
      "Windows",
    ],
    [
      "Firefox on Linux",
      "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
      "Firefox 127",
      "Linux",
    ],
    [
      "Safari on iPhone, which also mentions Mac OS X",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Safari 17",
      "iOS",
    ],
    [
      "Safari on macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "Safari 17",
      "macOS",
    ],
    [
      "Chrome on Android, which also mentions Linux",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36",
      "Chrome 126",
      "Android",
    ],
    [
      "Opera on ChromeOS",
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 OPR/110.0.0.0",
      "Opera 110",
      "ChromeOS",
    ],
  ])("recognizes %s", (_, userAgent, browser, operatingSystem) => {
    expect(parseUserAgent(userAgent)).toEqual({ browser, operatingSystem });
  });

  it.each([null, ""])("returns no information for %j", (userAgent) => {
    expect(parseUserAgent(userAgent)).toEqual({
      browser: null,
      operatingSystem: null,
    });
  });

  it("returns no match for an unknown agent and names a browser without a version", () => {
    expect(parseUserAgent("curl/8.0")).toEqual({
      browser: null,
      operatingSystem: null,
    });
    expect(parseUserAgent("Firefox/ nightly")).toMatchObject({
      browser: "Firefox",
    });
  });
});
