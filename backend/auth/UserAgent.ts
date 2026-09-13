/** Browser and operating system derived from a raw user agent string. */
export interface UserAgentInfo {
  readonly browser: string | null;
  readonly operatingSystem: string | null;
}

/** Known operating system user-agent markers checked in a fixed order. */
const OPERATING_SYSTEM_MARKERS = [
  { name: "Windows", pattern: /Windows NT/u },
  { name: "macOS", pattern: /Mac OS X|Macintosh/u },
  { name: "ChromeOS", pattern: /CrOS/u },
  { name: "iOS", pattern: /iPhone|iPad|iPod/u },
  { name: "Android", pattern: /Android/u },
  { name: "Linux", pattern: /Linux/u },
] as const;

/** Known browser user-agent markers checked in a fixed order. */
const BROWSER_MARKERS = [
  { name: "Edge", marker: "Edg/" },
  { name: "Opera", marker: "OPR/" },
  { name: "Firefox", marker: "Firefox/" },
  { name: "Chrome", marker: "Chrome/" },
  { name: "Safari", marker: "Version/" },
] as const;

const MAJOR_VERSION_PATTERN = /(\d+)/u;

/**
 * Derives a short browser and operating system description from a user agent.
 *
 * @param userAgent - Raw user agent recorded by the browser.
 * @returns Browser name with major version and operating system name, each
 * `null` when the user agent does not contain a reliable match.
 *
 * @remarks
 * Deliberately limited to browser family and major version plus the operating
 * system family, because concrete device models cannot be derived reliably.
 */
export function parseUserAgent(userAgent: string | null): UserAgentInfo {
  if (!userAgent) {
    return { browser: null, operatingSystem: null };
  }

  return {
    browser: matchBrowser(userAgent),
    operatingSystem: matchOperatingSystem(userAgent),
  };
}

function matchOperatingSystem(userAgent: string): string | null {
  for (const marker of OPERATING_SYSTEM_MARKERS) {
    if (marker.pattern.test(userAgent)) {
      return marker.name;
    }
  }

  return null;
}

function matchBrowser(userAgent: string): string | null {
  for (const candidate of BROWSER_MARKERS) {
    const markerIndex = userAgent.indexOf(candidate.marker);

    if (markerIndex === -1) {
      continue;
    }

    const version = userAgent
      .slice(markerIndex + candidate.marker.length)
      .match(MAJOR_VERSION_PATTERN);

    return version ? `${candidate.name} ${version[0]}` : candidate.name;
  }

  return null;
}
