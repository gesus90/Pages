import { expect, it } from "vitest";

import { parseUserAgent } from "./UserAgent";

const CHROME_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.109 Safari/537.36";
const EDGE_ON_WINDOWS = `${CHROME_ON_WINDOWS} Edg/120.0.2210.91`;
const OPERA_ON_MACOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0";
const FIREFOX_ON_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
const SAFARI_ON_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
const SAFARI_ON_MACOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15";
const CHROME_ON_CHROMEOS =
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CHROME_ON_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

it("returns no browser and no operating system without a user agent", () => {
  expect(parseUserAgent(null)).toEqual({
    browser: null,
    operatingSystem: null,
  });
  expect(parseUserAgent("")).toEqual({
    browser: null,
    operatingSystem: null,
  });
});

it("reports the browser family with its major version and the operating system", () => {
  expect(parseUserAgent(CHROME_ON_WINDOWS)).toEqual({
    browser: "Chrome 120",
    operatingSystem: "Windows",
  });
});

it("prefers the Edge marker over the Chrome marker it also contains", () => {
  expect(parseUserAgent(EDGE_ON_WINDOWS).browser).toBe("Edge 120");
});

it("recognizes Opera, Firefox and Safari by their own markers", () => {
  expect(parseUserAgent(OPERA_ON_MACOS)).toEqual({
    browser: "Opera 106",
    operatingSystem: "macOS",
  });
  expect(parseUserAgent(FIREFOX_ON_LINUX)).toEqual({
    browser: "Firefox 121",
    operatingSystem: "Linux",
  });
  expect(parseUserAgent(SAFARI_ON_MACOS).browser).toBe("Safari 17");
});

it("reports iOS for iPhone agents although they also contain the macOS marker", () => {
  expect(parseUserAgent(SAFARI_ON_IPHONE)).toEqual({
    browser: "Safari 17",
    operatingSystem: "iOS",
  });
});

it("reports ChromeOS and Android, where Android wins over the Linux marker", () => {
  expect(parseUserAgent(CHROME_ON_CHROMEOS).operatingSystem).toBe("ChromeOS");
  expect(parseUserAgent(CHROME_ON_ANDROID)).toEqual({
    browser: "Chrome 120",
    operatingSystem: "Android",
  });
});

it("keeps only the browser name when the marker has no version", () => {
  expect(parseUserAgent("Chrome/")).toEqual({
    browser: "Chrome",
    operatingSystem: null,
  });
});

it("reports nulls for an unrecognized user agent", () => {
  expect(parseUserAgent("curl/8.5.0")).toEqual({
    browser: null,
    operatingSystem: null,
  });
});
