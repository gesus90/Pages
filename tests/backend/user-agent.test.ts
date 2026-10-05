import { describe, expect, it } from "vitest";

import { parseUserAgent } from "@/backend/auth/UserAgent";

const FIREFOX_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/129.0.2792.52`;
const OPERA_WINDOWS = `${CHROME_WINDOWS} OPR/114.0.0.0`;
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const CHROME_OS =
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

describe("parseUserAgent", () => {
  it.each([
    [FIREFOX_LINUX, "Firefox 130", "Linux"],
    [CHROME_WINDOWS, "Chrome 129", "Windows"],
    [SAFARI_MAC, "Safari 17", "macOS"],
    [CHROME_OS, "Chrome 129", "ChromeOS"],
  ])("recognizes %s", (userAgent, browser, operatingSystem) => {
    expect(parseUserAgent(userAgent)).toEqual({ browser, operatingSystem });
  });

  it("prefers Edge and Opera over the Chrome marker they also send", () => {
    expect(parseUserAgent(EDGE_WINDOWS).browser).toBe("Edge 129");
    expect(parseUserAgent(OPERA_WINDOWS).browser).toBe("Opera 114");
  });

  it("recognizes mobile systems before the desktop systems they imitate", () => {
    expect(parseUserAgent(SAFARI_IPHONE).operatingSystem).toBe("iOS");
    expect(parseUserAgent(CHROME_ANDROID).operatingSystem).toBe("Android");
  });

  it("returns only the major version", () => {
    expect(parseUserAgent("Firefox/131.2.3").browser).toBe("Firefox 131");
  });

  it("keeps the browser name when no version follows the marker", () => {
    expect(parseUserAgent("Foo Chrome/ Bar").browser).toBe("Chrome");
  });

  it("returns nulls for unknown agents", () => {
    expect(parseUserAgent("curl/8.5.0")).toEqual({
      browser: null,
      operatingSystem: null,
    });
  });

  it("returns nulls for missing agents", () => {
    expect(parseUserAgent(null)).toEqual({
      browser: null,
      operatingSystem: null,
    });
    expect(parseUserAgent("")).toEqual({
      browser: null,
      operatingSystem: null,
    });
  });
});
